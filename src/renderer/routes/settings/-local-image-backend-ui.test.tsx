// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ discover: vi.fn(), regular: vi.fn(), setSteps: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (value: unknown) => value, Link: 'a' }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, values?: Record<string, string>) => key.replace(/{{(\w+)}}/g, (_, name) => values?.[name] || name) }),
}))
vi.mock('@/packages/local-image-backend', async (original) => ({
  ...await original<typeof import('../../packages/local-image-backend')>(), getLocalImageModels: mocks.discover,
}))
vi.mock('./-modelRigTest', () => ({ runSlotTest: mocks.regular }))
vi.mock('@/adapters', () => ({ createModelDependencies: vi.fn() }))
vi.mock('@/components/AdaptiveSelect', () => ({ AdaptiveSelect: () => null }))
vi.mock('@/components/ImageModelSelect', () => ({ ImageModelSelect: ({ children, modelGroups }: { children: React.ReactNode; modelGroups: { models: { displayName: string }[] }[] }) => <button type="button" aria-label="Image models">{children}{modelGroups.flatMap((group) => group.models).map((model) => <span key={model.displayName}>{model.displayName}</span>)}</button> }))
vi.mock('@/components/ModelSelectorV2', () => ({ default: () => null }))
vi.mock('@/hooks/useImageModelGroups', () => ({ useImageModelGroups: () => [] }))
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [] }) }))
vi.mock('@/packages/model-registry', () => ({ enrichModelsFromRegistry: () => [], useModelRegistryVersion: vi.fn() }))
vi.mock('@/packages/web-search', () => ({ testWebSearchConnection: vi.fn() }))
vi.mock('@/platform', () => ({ default: {} }))
vi.mock('@/stores/settingsStore', () => {
  const settings = { providers: {}, customProviders: [], extension: {}, setSettings: vi.fn() }
  return {
    settingsStore: { getState: () => settings },
    useSettingsStore: (select: (value: typeof settings) => unknown) => select(settings),
    getPlatformDefaultDocumentParser: () => ({ type: 'local' }),
  }
})
vi.mock('@/stores/lastUsedModelStore', async () => {
  const { create } = await import('zustand')
  const store = create(() => ({
    picture: undefined as { provider: string; modelId: string } | undefined,
    setPictureModel: (provider: string, modelId: string) => store.setState({ picture: { provider, modelId } }),
  }))
  return { lastUsedModelStore: store, useLastUsedModelStore: store }
})
vi.mock('@/stores/queryClient', async () => {
  const { QueryClient } = await import('@tanstack/react-query')
  return { queryClient: new QueryClient() }
})
vi.mock('@/utils/model-tester', () => ({ pingModel: vi.fn() }))

import { lastUsedModelStore } from '../../stores/lastUsedModelStore'
import { useLocalImageBackendStore } from '../../stores/localImageBackendStore'
import { queryClient } from '../../stores/queryClient'
import { RouteComponent } from './default-models'

const discovery = { baseUrl: 'http://draft:7860', models: [{ id: 'model', name: 'Model' }], currentModelId: 'model' }
const originalSetSteps = useLocalImageBackendStore.getState().setSteps

beforeEach(() => {
  vi.clearAllMocks()
  queryClient.clear()
  lastUsedModelStore.setState({ picture: undefined })
  useLocalImageBackendStore.setState({ url: '', defaultModelId: '', steps: 20, setSteps: originalSetSteps })
  mocks.discover.mockResolvedValue(discovery)
  mocks.regular.mockResolvedValue({ status: 'ok', latencyMs: 0 })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})
afterEach(cleanup)

function show() {
  render(<QueryClientProvider client={queryClient}><MantineProvider><RouteComponent /></MantineProvider></QueryClientProvider>)
  return {
    input: screen.getByRole('textbox', { name: 'Local SDAPI address' }) as HTMLInputElement,
    check: screen.getByRole('button', { name: 'Check Image generation' }),
  }
}

describe('image default settings form', () => {
  it('starts empty, shows None, disables steps and never probes on mount or draft edits', () => {
    const { input } = show()
    expect(input.value).toBe('')
    expect(input.getAttribute('placeholder')).toBeNull()
    expect(screen.getByRole('button', { name: 'Image models' }).textContent).toBe('None')
    expect((screen.getByRole('textbox', { name: 'Steps' }) as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'http://draft:7860' } })
    expect(mocks.discover).not.toHaveBeenCalled()
    expect(useLocalImageBackendStore.getState()).toMatchObject({ url: '', defaultModelId: '', steps: 20 })
  })

  it('does not prefill or discover a legacy history address', () => {
    lastUsedModelStore.setState({ picture: { provider: 'local-sdapi', modelId: 'http://legacy:7860' } })
    expect(show().input.value).toBe('')
    expect(screen.getByRole('button', { name: 'Image models' }).textContent).toBe('None')
    expect(mocks.discover).not.toHaveBeenCalled()
  })

  it('keeps fresh models empty after failed validation', async () => {
    mocks.discover.mockRejectedValue(new Error('HTTP 503'))
    const { input, check } = show()
    fireEvent.change(input, { target: { value: 'http://broken:7860' } })
    fireEvent.click(check)
    await screen.findByText(/^Needs attention/)
    expect(screen.getByRole('button', { name: 'Image models' }).textContent).toBe('None')
    expect(useLocalImageBackendStore.getState()).toMatchObject({ url: '', defaultModelId: '', steps: 20 })
    expect(queryClient.getQueryData(['local-image-models', 'http://broken:7860'])).toBeUndefined()
  })

  it('uses the single connection action to validate an initially unconfigured draft and show success', async () => {
    const { input, check } = show()
    expect(check.textContent).toBe('Test connection')
    expect(screen.queryByRole('button', { name: 'Validate' })).toBeNull()
    fireEvent.change(input, { target: { value: 'http://draft:7860/' } })
    expect(mocks.discover).not.toHaveBeenCalled()
    fireEvent.click(check)
    await screen.findByText(/^Connected/)
    expect(mocks.discover).toHaveBeenCalledWith('http://draft:7860', expect.any(AbortSignal))
    expect(useLocalImageBackendStore.getState()).toMatchObject({ url: 'http://draft:7860', defaultModelId: 'model' })
    expect(lastUsedModelStore.getState().picture).toEqual({ provider: 'local-sdapi', modelId: 'model' })
    expect(queryClient.getQueryData(['local-image-models', 'http://draft:7860'])).toEqual(discovery)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Image models' }).textContent).toContain('Model'))
    expect((screen.getByRole('textbox', { name: 'Steps' }) as HTMLInputElement).disabled).toBe(false)
    expect(mocks.discover).toHaveBeenCalledTimes(1)
  })

  it('checks the edited URL, clears a failing draft, and retains saved defaults', async () => {
    useLocalImageBackendStore.setState({ url: 'http://saved:7860', defaultModelId: 'saved' })
    lastUsedModelStore.setState({ picture: { provider: 'local-sdapi', modelId: 'saved' } })
    mocks.discover.mockRejectedValue(new Error('HTTP 503'))
    const { input, check } = show()
    fireEvent.change(input, { target: { value: 'http://broken:7860' } })
    fireEvent.click(check)
    await screen.findByText(/^Needs attention/)
    expect(mocks.discover).toHaveBeenCalledWith('http://broken:7860', expect.any(AbortSignal))
    expect(input.value).toBe('')
    expect(useLocalImageBackendStore.getState()).toMatchObject({ url: 'http://saved:7860', defaultModelId: 'saved' })
    expect(lastUsedModelStore.getState().picture?.modelId).toBe('saved')
  })

  it('keeps generic image model checks when the address is not edited', async () => {
    lastUsedModelStore.setState({ picture: { provider: 'openai', modelId: 'gpt-image-1' } })
    const { check } = show()
    fireEvent.click(check)
    await waitFor(() => expect(mocks.regular).toHaveBeenCalledWith('image', expect.objectContaining({ picture: { provider: 'openai', modelId: 'gpt-image-1' } })))
    expect(mocks.discover).not.toHaveBeenCalled()
  })

  it('uses the same validation for Enter and Check all', async () => {
    const { input } = show()
    fireEvent.change(input, { target: { value: 'http://draft:7860' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText(/^Connected/)
    fireEvent.change(input, { target: { value: 'http://next:7860' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check all' }))
    await waitFor(() => expect(useLocalImageBackendStore.getState().url).toBe('http://next:7860'))
  })

  it('renders integer spinbox steps 1–40 and persists changes through the store', async () => {
    // Isolate the UI contract: the backend/store bound is changed separately.
    mocks.setSteps.mockImplementation((steps: number) => useLocalImageBackendStore.setState({ steps }))
    useLocalImageBackendStore.setState({ setSteps: mocks.setSteps })
    useLocalImageBackendStore.setState({ url: 'http://saved:7860', steps: 7 })
    show()
    const steps = screen.getByRole('textbox', { name: 'Steps' }) as HTMLInputElement
    expect(steps.disabled).toBe(false)
    expect(steps.value).toBe('7')
    expect(steps.getAttribute('inputmode')).toBe('numeric')
    fireEvent.change(steps, { target: { value: '40' } })
    expect(mocks.setSteps).toHaveBeenLastCalledWith(40)
    fireEvent.change(steps, { target: { value: '41' } })
    expect(mocks.setSteps).toHaveBeenLastCalledWith(40)
    fireEvent.change(steps, { target: { value: '0' } })
    expect(mocks.setSteps).toHaveBeenLastCalledWith(40)
    fireEvent.change(steps, { target: { value: '1' } })
    expect(mocks.setSteps).toHaveBeenLastCalledWith(1)
    await act(async () => {})
  })
})