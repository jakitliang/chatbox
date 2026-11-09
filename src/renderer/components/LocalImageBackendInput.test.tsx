// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalImageBackendInput, type LocalImageBackendInputHandle } from './LocalImageBackendInput'

const backend = vi.hoisted(() => ({ validate: vi.fn(), save: vi.fn() }))
vi.mock('@/adapters', () => ({ createModelDependencies: vi.fn() }))
vi.mock('@/packages/local-image-backend', async (importOriginal) => {
  const original = await importOriginal<typeof import('../packages/local-image-backend')>()
  return { ...original, getLocalImageModels: backend.validate }
})
vi.mock('@/stores/lastUsedModelStore', async () => {
  const { createStore, useStore } = await import('zustand')
  const store = createStore(() => ({
    picture: undefined as { provider: string; modelId: string } | undefined,
    setPictureModel: backend.save,
  }))
  return { lastUsedModelStore: store, useLastUsedModelStore: (selector: (state: ReturnType<typeof store.getState>) => unknown) => useStore(store, selector) }
})
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/stores/queryClient', async () => {
  const { QueryClient } = await import('@tanstack/react-query')
  return { queryClient: new QueryClient() }
})
import { lastUsedModelStore } from '../stores/lastUsedModelStore'
import { useLocalImageBackendStore } from '../stores/localImageBackendStore'
import { queryClient } from '../stores/queryClient'

beforeEach(() => {
  vi.clearAllMocks()
  lastUsedModelStore.setState({ picture: undefined })
  useLocalImageBackendStore.setState({ url: '', defaultModelId: '', steps: 20 })
  queryClient.clear()
  backend.validate.mockResolvedValue({
    baseUrl: 'http://localhost:7860',
    models: [{ id: 'recipe-model', name: 'SDXL · model.safetensors' }],
    currentModelId: 'recipe-model',
  })
  backend.save.mockImplementation((provider, modelId) => lastUsedModelStore.setState({ picture: { provider, modelId } }))
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})
afterEach(cleanup)

function show(onValidated = vi.fn(), onKeyDown = vi.fn()) {
  const ref = createRef<LocalImageBackendInputHandle>()
  const view = render(
    <MantineProvider>
      <div onKeyDown={onKeyDown}>
        <LocalImageBackendInput ref={ref} onValidated={onValidated} />
      </div>
    </MantineProvider>
  )
  const input = screen.getByRole('textbox', { name: 'Local SDAPI address' }) as HTMLInputElement
  const enter = (value: string) => {
    fireEvent.change(input, { target: { value } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }
  return { ...view, ref, input, enter, onValidated, onKeyDown }
}

function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('LocalImageBackendInput', () => {
  it('does not request or save a placeholder or stored address on mount', () => {
    const empty = show()
    expect(empty.input.value).toBe('')
    empty.unmount()
    lastUsedModelStore.setState({ picture: { provider: 'local-sdapi', modelId: 'http://saved:7860' } })
    expect(show().input.value).toBe('')
    expect(backend.validate).not.toHaveBeenCalled()
    expect(backend.save).not.toHaveBeenCalled()
  })

  it('normalizes, validates, then saves dedicated defaults without writing picture and stops Enter propagation', async () => {
    const view = show()
    view.enter('  http://localhost:7860///  ')
    expect(backend.validate).toHaveBeenCalledWith('http://localhost:7860', expect.any(AbortSignal))
    await waitFor(() => expect(useLocalImageBackendStore.getState()).toMatchObject({
      url: 'http://localhost:7860', defaultModelId: 'recipe-model', steps: 20,
    }))
    expect(backend.save).not.toHaveBeenCalled()
    expect(lastUsedModelStore.getState().picture).toBeUndefined()
    expect(view.input.value).toBe('http://localhost:7860')
    expect(view.onValidated).toHaveBeenCalledOnce()
    expect(view.onKeyDown).not.toHaveBeenCalled()
  })

  it('clears failed text, explains the failure and preserves the previous valid address', async () => {
    const previous = { provider: 'local-sdapi', modelId: 'http://saved:7860' }
    lastUsedModelStore.setState({ picture: previous })
    useLocalImageBackendStore.setState({ url: 'http://saved:7860', defaultModelId: 'saved-model', steps: 7 })
    backend.validate.mockRejectedValue(new Error('HTTP 503'))
    const view = show()
    view.enter('http://broken:7860')
    await screen.findByText(/validation failed.*HTTP 503/)
    expect(view.input.value).toBe('')
    expect(lastUsedModelStore.getState().picture).toEqual(previous)
    expect(useLocalImageBackendStore.getState()).toMatchObject({ url: 'http://saved:7860', defaultModelId: 'saved-model', steps: 7 })
    expect(screen.queryByText('Local SDAPI · http://saved:7860')).toBeNull()
    expect(backend.save).not.toHaveBeenCalled()
  })

  it('rejects invalid addresses without probing or replacing a legacy model', async () => {
    const previous = { provider: 'openai', modelId: 'gpt-image-1' }
    lastUsedModelStore.setState({ picture: previous })
    const view = show()
    view.enter('file:///tmp/image')
    await screen.findByText(/validation failed/)
    expect(view.input.value).toBe('')
    expect(backend.validate).not.toHaveBeenCalled()
    expect(lastUsedModelStore.getState().picture).toEqual(previous)
  })

  it('ignores a stale failure after a newer address succeeds', async () => {
    const first = deferred()
    backend.validate.mockReturnValueOnce(first.promise)
    const view = show()
    view.enter('http://first:7860')
    const signal = backend.validate.mock.calls[0][1] as AbortSignal
    view.enter('http://second:7860')
    expect(signal.aborted).toBe(true)
    await waitFor(() => expect(useLocalImageBackendStore.getState().url).toBe('http://second:7860'))
    await act(async () => first.reject(new Error('old failure')))
    expect(view.input.value).toBe('http://second:7860')
    expect(screen.queryByText(/validation failed/)).toBeNull()
    expect(backend.save).not.toHaveBeenCalled()
    expect(useLocalImageBackendStore.getState().url).toBe('http://second:7860')
  })

  it('does not save a stale success after editing or unmounting', async () => {
    const pending = deferred()
    backend.validate.mockReturnValue(pending.promise)
    const view = show()
    view.enter('http://first:7860')
    const signal = backend.validate.mock.calls[0][1] as AbortSignal
    fireEvent.change(view.input, { target: { value: 'http://edited:7860' } })
    expect(signal.aborted).toBe(true)
    view.enter('http://next:7860')
    const nextSignal = backend.validate.mock.calls[1][1] as AbortSignal
    view.unmount()
    expect(nextSignal.aborted).toBe(true)
    await act(async () => pending.resolve({}))
    expect(backend.save).not.toHaveBeenCalled()
    expect(useLocalImageBackendStore.getState().url).toBe('')
    expect(view.onValidated).not.toHaveBeenCalled()
  })

  it('cancels validation when the selected model changes elsewhere', async () => {
    const pending = deferred()
    backend.validate.mockReturnValue(pending.promise)
    const view = show()
    view.enter('http://pending:7860')
    act(() => lastUsedModelStore.setState({ picture: { provider: 'openai', modelId: 'gpt-image-1' } }))
    await act(async () => pending.resolve({}))
    expect(backend.save).not.toHaveBeenCalled()
    expect(lastUsedModelStore.getState().picture?.provider).toBe('openai')
    expect(useLocalImageBackendStore.getState().url).toBe('')
  })

  it('prefers the saved dedicated URL over a legacy address without automatic validation', () => {
    lastUsedModelStore.setState({ picture: { provider: 'local-sdapi', modelId: 'http://legacy:7860' } })
    useLocalImageBackendStore.setState({ url: 'http://saved:7860' })
    expect(show().input.value).toBe('http://saved:7860')
    expect(backend.validate).not.toHaveBeenCalled()
  })

  it('never prefills a legacy address and requires the user to enter it before validation', async () => {
    lastUsedModelStore.setState({ picture: { provider: 'local-sdapi', modelId: 'http://legacy:7860' } })
    useLocalImageBackendStore.setState({ defaultModelId: 'recipe-model', steps: 1 })
    const view = show()
    expect(view.input.value).toBe('')
    expect(useLocalImageBackendStore.getState().url).toBe('')
    await act(async () => { expect(await view.ref.current?.validate()).toMatchObject({ status: 'fail' }) })
    expect(backend.validate).not.toHaveBeenCalled()
    fireEvent.change(view.input, { target: { value: 'http://legacy:7860' } })
    await act(async () => { expect(await view.ref.current?.validate()).toEqual({ status: 'ok' }) })
    await waitFor(() => expect(useLocalImageBackendStore.getState()).toMatchObject({
      url: 'http://legacy:7860', defaultModelId: 'recipe-model', steps: 1,
    }))
    expect(view.onValidated).toHaveBeenCalledOnce()
    expect(backend.save).not.toHaveBeenCalled()
  })

  it('exposes current draft validation without rendering a second action and primes model discovery', async () => {
    const view = show()
    expect(screen.queryByRole('button', { name: 'Validate' })).toBeNull()
    fireEvent.change(view.input, { target: { value: 'http://draft:7860' } })
    expect(view.ref.current?.hasDraft()).toBe(true)
    expect(backend.validate).not.toHaveBeenCalled()
    expect(useLocalImageBackendStore.getState().url).toBe('')
    await act(async () => { expect(await view.ref.current?.validate()).toEqual({ status: 'ok' }) })
    expect(backend.validate).toHaveBeenCalledWith('http://draft:7860', expect.any(AbortSignal))
    expect(queryClient.getQueryData(['local-image-models', 'http://draft:7860'])).toMatchObject({ currentModelId: 'recipe-model' })
  })

  it('returns a failed result to the connection check while preserving saved defaults', async () => {
    useLocalImageBackendStore.setState({ url: 'http://saved:7860', defaultModelId: 'saved' })
    backend.validate.mockRejectedValue(new Error('HTTP 503'))
    const view = show()
    fireEvent.change(view.input, { target: { value: 'http://draft:7860' } })
    await act(async () => {
      expect(await view.ref.current?.validate()).toEqual({ status: 'fail', error: 'HTTP 503' })
    })
    expect(view.input.value).toBe('')
    expect(useLocalImageBackendStore.getState()).toMatchObject({ url: 'http://saved:7860', defaultModelId: 'saved' })
  })

  it('delegates Enter to the existing connection action when provided', () => {
    const onValidationRequested = vi.fn()
    render(<MantineProvider><LocalImageBackendInput onValidationRequested={onValidationRequested} /></MantineProvider>)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onValidationRequested).toHaveBeenCalledOnce()
    expect(backend.validate).not.toHaveBeenCalled()
  })
})