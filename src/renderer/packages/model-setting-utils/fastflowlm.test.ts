import { ModelProviderEnum, type ProviderModelInfo } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import { describe, expect, it, vi } from 'vitest'
import { createModelDependencies } from '@/adapters'
import RegistrySettingUtil from './registry-setting-util'

vi.mock('@/adapters', () => ({ createModelDependencies: vi.fn() }))
vi.mock('@/stores/settingsStore', () => ({ settingsStore: { getState: () => ({ providers: {} }) } }))
vi.mock('@/packages/model-registry', () => ({
  enrichModelsFromRegistry: (models: ProviderModelInfo[]) => models,
  getRegistry: vi.fn(),
  getDiscoveredModels: vi.fn(() => []),
  getProviderModelsFromRegistry: vi.fn(() => []),
}))
vi.mock('@/packages/remote', () => ({ getModelManifest: vi.fn().mockResolvedValue({ models: [] }) }))

describe('FastFlowLM manual model settings', () => {
  it('preserves saved metadata on refresh and leaves new catalog entries unconfigured', async () => {
    const saved: ProviderModelInfo = {
      modelId: 'fixture-local',
      nickname: 'My local model',
      type: 'chat',
      capabilities: ['vision', 'reasoning', 'tool_use'],
      contextWindow: 8192,
      maxOutput: 512,
    }
    const settings = { apiHost: 'http://localhost:52625', models: [saved] }
    const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: saved.modelId }, { id: 'fixture-new' }] }))
    )
    vi.mocked(createModelDependencies).mockResolvedValue({
      request: { apiRequest, fetchWithOptions: vi.fn() },
      storage: { saveImage: vi.fn(), getImage: vi.fn() },
      sentry: { captureException: vi.fn(), withScope: vi.fn() },
      getRemoteConfig: vi.fn(),
    })
    const util = new RegistrySettingUtil(ModelProviderEnum.FastFlowLM)
    const catalog = await util.getMergeOptionGroups(settings)
    expect(catalog[0]).toBe(saved)
    expect(catalog[1]).toEqual({ modelId: 'fixture-new', type: 'chat' })
    expect(settings.models).toEqual([saved])
    expect(await util.getCurrentModelDisplayName(saved.modelId, 'chat', settings)).toBe('FastFlowLM (My local model)')
  })
})