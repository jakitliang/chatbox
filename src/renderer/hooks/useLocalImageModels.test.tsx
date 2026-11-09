// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocalImageBackendStore } from '../stores/localImageBackendStore'
import { useLocalImageModels } from './useLocalImageModels'

const backend = vi.hoisted(() => ({ discover: vi.fn() }))
vi.mock('@/adapters', () => ({ createModelDependencies: vi.fn() }))
vi.mock('@/packages/local-image-backend', async (importOriginal) => ({
  ...await importOriginal<typeof import('../packages/local-image-backend')>(),
  getLocalImageModels: backend.discover,
}))

const id = 'local-sdapi:v2:{"recipe":"sdxl-checkpoint","models":{"model":"sdxl.safetensors"}}'
const capabilities = { aspectRatio: {}, inputReferences: null }

beforeEach(() => {
  vi.clearAllMocks()
  useLocalImageBackendStore.setState({ url: '', defaultModelId: id, steps: 4 })
  backend.discover.mockResolvedValue({ models: [{ id, name: 'SDXL', description: 'sdxl.safetensors', capabilities }], currentModelId: id })
})
afterEach(cleanup)

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(useLocalImageModels, { wrapper })
}

describe('saved local image model discovery', () => {
  it('does not probe an unconfigured address or mutate defaults', () => {
    expect(show().result.current.group).toBeUndefined()
    expect(backend.discover).not.toHaveBeenCalled()
    expect(useLocalImageBackendStore.getState()).toMatchObject({ url: '', defaultModelId: id, steps: 4 })
  })

  it('uses the saved URL and maps actual configuration IDs, names and capabilities into the existing menu type', async () => {
    useLocalImageBackendStore.setState({ url: 'http://saved:7860' })
    const { result } = show()
    await waitFor(() => expect(result.current.group?.models).toEqual([
      { modelId: id, displayName: 'SDXL', description: 'sdxl.safetensors', capabilities },
    ]))
    expect(backend.discover).toHaveBeenCalledWith('http://saved:7860', expect.any(AbortSignal))
    expect(result.current.group).toMatchObject({ providerId: 'local-sdapi', isCustom: true })
    expect(useLocalImageBackendStore.getState()).toMatchObject({ defaultModelId: id, steps: 4 })
  })

  it('preserves defaults when discovery fails', async () => {
    useLocalImageBackendStore.setState({ url: 'http://saved:7860' })
    backend.discover.mockRejectedValue(new Error('offline'))
    const { result } = show()
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.group).toBeUndefined()
    expect(useLocalImageBackendStore.getState()).toMatchObject({ url: 'http://saved:7860', defaultModelId: id, steps: 4 })
  })

  it('does not expose cached models for an empty URL', () => {
    const client = new QueryClient()
    client.setQueryData(['local-image-models', ''], { models: [{ id, name: 'Stale model' }] })
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    expect(renderHook(useLocalImageModels, { wrapper }).result.current.group).toBeUndefined()
    expect(backend.discover).not.toHaveBeenCalled()
  })
})