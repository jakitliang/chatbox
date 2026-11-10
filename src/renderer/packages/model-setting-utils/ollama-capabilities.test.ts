import { getModel } from '@shared/providers'
import { refreshOllamaModelCapabilities } from '@shared/providers/ollama-capabilities'
import { type Config, ModelProviderEnum, type ProviderModelInfo, type Settings } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createModelDependencies } from '@/adapters'
import * as remote from '@/packages/remote'
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

const response = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data)))

describe('Ollama settings capability refresh', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refreshes saved models, preserves customization and propagates metadata to selector/runtime', async () => {
    const existing: ProviderModelInfo[] = [
      { modelId: 'gpt-oss:20b', nickname: 'Local GPT', contextWindow: 8192, capabilities: [] },
      { modelId: 'qwen3:plain', capabilities: ['tool_use', 'vision'] },
      { modelId: 'failed-show', capabilities: ['vision'] },
      { modelId: 'offline-model', nickname: 'Keep me' },
    ]
    const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockImplementation((options) => {
      if (options.method === 'GET') {
        return response({
          models: ['gpt-oss:20b', 'qwen3:plain', 'failed-show', 'new-alias'].map((name) => ({ name })),
        })
      }
      const { model } = JSON.parse(options.body as string)
      if (model === 'failed-show') return Promise.reject(new Error('unavailable'))
      return response({
        capabilities: model === 'qwen3:plain' ? ['completion'] : ['completion', 'tools', 'thinking'],
      })
    })
    const deps: ModelDependencies = {
      request: { apiRequest, fetchWithOptions: vi.fn() },
      storage: { saveImage: vi.fn(), getImage: vi.fn() },
      sentry: { captureException: vi.fn(), withScope: vi.fn() },
      getRemoteConfig: vi.fn(),
    }
    vi.mocked(createModelDependencies).mockResolvedValue(deps)
    const util = new RegistrySettingUtil(ModelProviderEnum.Ollama)
    const options = await util.getMergeOptionGroups({
      apiHost: 'http://localhost:11434',
      models: existing,
      useProxy: true,
    })

    expect(remote.getModelManifest).not.toHaveBeenCalled()
    expect(options.map((model) => model.modelId)).toEqual([...existing.map((model) => model.modelId), 'new-alias'])
    expect(options[0]).toMatchObject({ ...existing[0], capabilities: ['tool_use', 'reasoning'] })
    expect(options[1].capabilities).toEqual([])
    expect(options[2]).toBe(existing[2])
    expect(options[3]).toBe(existing[3])
    expect(options[4].capabilities).toEqual(['tool_use', 'reasoning'])

    // Fetch dialog already has existing entries checked. Its persistence path
    // must refresh them without adding unselected newly discovered models.
    const persisted = refreshOllamaModelCapabilities(existing, options)
    expect(persisted).toEqual(options.slice(0, 4))
    expect(existing[0].capabilities).toEqual([])
    const selectorModel = persisted[0]
    expect(selectorModel.capabilities?.includes('tool_use')).toBe(true)
    const runtime = getModel(
      { provider: 'ollama', modelId: selectorModel.modelId },
      { providers: { ollama: { models: persisted } } } as Settings,
      { uuid: '' } as Config,
      deps
    )
    expect(runtime.isSupportToolUse('agent')).toBe(true)
  })

  it('preserves saved capabilities if discovery is unavailable', () => {
    const models: ProviderModelInfo[] = [{ modelId: 'gpt-oss:20b', capabilities: ['tool_use'] }]
    expect(refreshOllamaModelCapabilities(models, [])).toEqual(models)
    expect(refreshOllamaModelCapabilities(models, [{ modelId: 'gpt-oss:20b' }])[0]).toBe(models[0])
    expect(
      refreshOllamaModelCapabilities(models, [{ modelId: 'gpt-oss:20b', capabilities: [] }])[0].capabilities
    ).toEqual([])
  })
})
