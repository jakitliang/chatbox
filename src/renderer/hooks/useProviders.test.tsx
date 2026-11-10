/**
 * @vitest-environment jsdom
 */
import { ModelProviderEnum, type ProviderModelInfo, type Settings } from '@shared/types'
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settings: {} as Partial<Settings>,
  setSettings: vi.fn(),
}))

vi.mock('@shared/defaults', () => ({
  SystemProviders: () => [
    { id: 'fastflowlm', name: 'FastFlowLM' },
    { id: 'ollama', name: 'Ollama' },
    { id: 'lm-studio', name: 'LM Studio' },
    { id: 'openai', name: 'OpenAI' },
  ],
}))
vi.mock('@/packages/model-registry', () => ({
  useModelRegistryVersion: vi.fn(),
  enrichModelsFromRegistry: (models: ProviderModelInfo[]) => models,
}))
vi.mock('@/platform', () => ({ default: { type: 'web' } }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: Partial<Settings> & { setSettings: typeof mocks.setSettings }) => unknown) =>
    selector({ ...mocks.settings, setSettings: mocks.setSettings }),
}))
vi.mock('./useChatboxAIModels', () => ({ default: () => ({ chatboxAIModels: [] }) }))

import { useProviders } from './useProviders'

const savedModel: ProviderModelInfo = {
  modelId: 'fixture-local',
  nickname: 'My local model',
  type: 'chat',
  capabilities: ['tool_use'],
}

describe('useProviders keyless local providers', () => {
  beforeEach(() => {
    mocks.settings = { providers: {}, customProviders: [], favoritedModels: [] }
    mocks.setSettings.mockClear()
  })
  afterEach(cleanup)

  it.each([ModelProviderEnum.FastFlowLM, ModelProviderEnum.Ollama, ModelProviderEnum.LMStudio])(
    'includes %s with a saved model and no credentials',
    (provider) => {
      mocks.settings.providers = { [provider]: { models: [savedModel] } }
      const { result } = renderHook(useProviders)

      expect(result.current.providers).toEqual([
        expect.objectContaining({ id: provider, models: [savedModel] }),
      ])
    }
  )

  it.each([undefined, []])('hides FastFlowLM when no models are saved (%j)', (models) => {
    mocks.settings.providers = { fastflowlm: { apiHost: 'http://localhost:52625', models } }
    const { result } = renderHook(useProviders)
    expect(result.current.providers).toEqual([])
  })

  it('updates the picker and favorites after saving the first FastFlowLM model', () => {
    mocks.settings.providers = { fastflowlm: { apiHost: 'http://localhost:52625', models: [] } }
    mocks.settings.favoritedModels = [{ provider: ModelProviderEnum.FastFlowLM, model: savedModel.modelId }]
    const { result, rerender } = renderHook(useProviders)
    expect(result.current.providers).toEqual([])
    expect(result.current.favoritedModels).toEqual([])

    mocks.settings.providers = { fastflowlm: { apiHost: 'http://localhost:52625', models: [savedModel] } }
    rerender()

    expect(result.current.providers[0]).toMatchObject({ id: ModelProviderEnum.FastFlowLM, models: [savedModel] })
    expect(result.current.favoritedModels).toEqual([
      { provider: result.current.providers[0], model: savedModel },
    ])
    expect(result.current.isFavoritedModel(ModelProviderEnum.FastFlowLM, savedModel.modelId)).toBe(true)
  })

  it('does not make authenticated built-in providers keyless', () => {
    mocks.settings.providers = { openai: { models: [savedModel] } }
    const { result } = renderHook(useProviders)
    expect(result.current.providers).toEqual([])
  })
})