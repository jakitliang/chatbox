import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ validate: vi.fn(), regular: vi.fn() }))
vi.mock('@/packages/local-image-backend', () => ({
  LOCAL_IMAGE_BACKEND_ID: 'local-sdapi',
  getLocalImageModels: mocks.validate,
}))
vi.mock('@/hooks/useLocalImageModels', () => ({ useLocalImageModels: vi.fn() }))
vi.mock('@/stores/localImageBackendStore', () => ({
  useLocalImageBackendStore: Object.assign(vi.fn(), { getState: () => ({ url: 'http://saved:7860' }) }),
}))
vi.mock('./-modelRigTest', () => ({ runSlotTest: mocks.regular }))
vi.mock('@/adapters', () => ({ createModelDependencies: vi.fn() }))
vi.mock('@/components/AdaptiveSelect', () => ({ AdaptiveSelect: () => null }))
vi.mock('@/components/ImageModelSelect', () => ({ ImageModelSelect: () => null }))
vi.mock('@/components/LocalImageBackendInput', () => ({ LocalImageBackendInput: () => null }))
vi.mock('@/components/ModelSelectorV2', () => ({ default: () => null }))
vi.mock('@/hooks/useImageModelGroups', () => ({ useImageModelGroups: vi.fn() }))
vi.mock('@/hooks/useProviders', () => ({ useProviders: vi.fn() }))
vi.mock('@/packages/model-registry', () => ({ enrichModelsFromRegistry: vi.fn(), useModelRegistryVersion: vi.fn() }))
vi.mock('@/packages/web-search', () => ({ testWebSearchConnection: vi.fn() }))
vi.mock('@/platform', () => ({ default: {} }))
vi.mock('@/stores/lastUsedModelStore', () => ({ lastUsedModelStore: {}, useLastUsedModelStore: vi.fn() }))
vi.mock('@/stores/settingsStore', () => ({ settingsStore: {}, useSettingsStore: vi.fn(), getPlatformDefaultDocumentParser: vi.fn() }))
vi.mock('@/utils/model-tester', () => ({ pingModel: vi.fn() }))

import type { ModelRigTestDeps } from './-modelRigTest'
import { runDefaultModelSlotTest } from './default-models'

function deps(provider = 'local-sdapi'): ModelRigTestDeps {
  return {
    settings: {} as ModelRigTestDeps['settings'],
    configuredProviderIds: new Set(),
    picture: { provider, modelId: 'local-sdapi:v2:{"recipe":"sdxl-checkpoint","models":{"model":"sdxl.safetensors"}}' },
    hasLicense: false,
    isDesktopLike: false,
    pingChat: vi.fn(),
    testMineru: vi.fn(),
    searchWeb: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.validate.mockResolvedValue({})
  mocks.regular.mockResolvedValue({ status: 'ok', latencyMs: 0 })
})

describe('default model local image connection checks', () => {
  it('uses the explicit draft validation result even before an image model is configured', async () => {
    const current = { ...deps(), picture: undefined }
    const validateDraft = vi.fn().mockResolvedValue({ status: 'ok' })
    expect(await runDefaultModelSlotTest('image', current, undefined, validateDraft)).toMatchObject({ status: 'ok' })
    expect(validateDraft).toHaveBeenCalledOnce()
    expect(mocks.validate).not.toHaveBeenCalled()
    expect(mocks.regular).not.toHaveBeenCalled()
  })

  it('reports draft failures rather than testing the saved address', async () => {
    const validateDraft = vi.fn().mockResolvedValue({ status: 'fail', error: 'draft failed' })
    expect(await runDefaultModelSlotTest('image', deps(), undefined, validateDraft)).toMatchObject({ status: 'fail', error: 'draft failed' })
    expect(mocks.validate).not.toHaveBeenCalled()
  })

  it('probes local SDAPI without provider registration or the regular provider check', async () => {
    const controller = new AbortController()
    const result = await runDefaultModelSlotTest('image', deps(), controller.signal)
    expect(result.status).toBe('ok')
    expect(mocks.validate).toHaveBeenCalledWith('http://saved:7860', controller.signal)
    expect(mocks.regular).not.toHaveBeenCalled()
  })

  it('reports the actual local backend failure', async () => {
    mocks.validate.mockRejectedValue(new Error('HTTP 503'))
    expect(await runDefaultModelSlotTest('image', deps())).toMatchObject({ status: 'fail', error: 'HTTP 503' })
    expect(mocks.regular).not.toHaveBeenCalled()
  })

  it('preserves checks for legacy image models and other slots', async () => {
    const legacy = deps('openai')
    await runDefaultModelSlotTest('image', legacy)
    expect(mocks.regular).toHaveBeenLastCalledWith('image', legacy)
    const local = deps()
    await runDefaultModelSlotTest('llm', local)
    expect(mocks.regular).toHaveBeenLastCalledWith('llm', local)
    expect(mocks.validate).not.toHaveBeenCalled()
  })
})