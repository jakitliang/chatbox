import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import FastFlowLM from './models/fastflowlm'

export const fastFlowLMProvider = defineProvider({
  id: ModelProviderEnum.FastFlowLM,
  name: 'FastFlowLM',
  type: ModelProviderType.OpenAI,
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
      },
      config.dependencies
    ),
  getDisplayName: (modelId, providerSettings) =>
    `FastFlowLM (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`,
})