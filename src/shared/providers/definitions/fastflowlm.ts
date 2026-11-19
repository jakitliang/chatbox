import { ModelProviderEnum, ModelProviderType, type ProviderSettings } from '../../types'
import { normalizeOpenAIApiHostAndPath } from '../../utils/llm_utils'
import { getRuntimeContextWindowValue } from '../context-window'
import { defineProvider } from '../registry'
import { fastFlowLMContextControl } from './fastflowlm-context-transport'
import FastFlowLM from './models/fastflowlm'

function runtimeHost(settings: ProviderSettings): string | undefined {
  if (!settings.apiHost?.trim()) return undefined
  return normalizeOpenAIApiHostAndPath({ apiHost: settings.apiHost }).apiHost.replace(/\/v1\/?$/, '')
}

export const fastFlowLMProvider = defineProvider({
  id: ModelProviderEnum.FastFlowLM,
  name: 'FastFlowLM',
  type: ModelProviderType.OpenAI,
  modelListSource: 'provider-only',
  contextWindowDelegate: {
    getContextWindow: getRuntimeContextWindowValue,
    control: fastFlowLMContextControl,
    runtime: {
      getCacheKey: (settings) => JSON.stringify([runtimeHost(settings), !!settings.useProxy]),
      async resolve(settings, modelId, request, signal) {
        const host = runtimeHost(settings)
        if (!host) return undefined
        // FLM's catalog capacities are not the window of the currently loaded model.
        const response = await request(`${host}/api/ps`, { useProxy: settings.useProxy, signal })
        if (!response.ok) throw new Error(`FastFlowLM ps request failed: ${response.status}`)
        const payload = await response.json()
        if (!Array.isArray(payload?.models)) return undefined
        let window: number | undefined
        for (const model of payload.models) {
          const length = model?.context_length
          if (!Number.isSafeInteger(length) || length <= 0) continue
          if (model.name !== modelId && model.model !== modelId) continue
          window = Math.min(window ?? length, length)
        }
        return window
      },
    },
  },
  urls: {
    website: 'https://fastflowlm.com',
  },
  // The endpoint and model metadata belong to the user's FLM installation.
  defaultSettings: {
    apiHost: '',
    models: [],
  },
  createModel: (config) =>
    new FastFlowLM(
      {
        apiHost: config.formattedApiHost,
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
        useProxy: config.providerSetting.useProxy,
        contextWindowControl: fastFlowLMContextControl,
      },
      config.dependencies,
      config.providerSetting.models
    ),
  getDisplayName: (modelId, providerSettings) =>
    `FastFlowLM (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`,
})
