import { ModelProviderType, type ProviderModelInfo } from '../types'
export const API_STYLE_BY_PROVIDER_TYPE: Partial<Record<ModelProviderType, ProviderModelInfo['apiStyle']>> = {
  [ModelProviderType.Claude]: 'anthropic',
  [ModelProviderType.Gemini]: 'google',
  [ModelProviderType.OpenAIResponses]: 'openai-responses',
  [ModelProviderType.OpenAI]: 'openai',
}

export function apiStyleFromProviderType(
  type: ModelProviderType | string | undefined
): ProviderModelInfo['apiStyle'] | undefined {
  return type ? API_STYLE_BY_PROVIDER_TYPE[type as ModelProviderType] : undefined
}

export function withResolvedModelApiStyle(
  model: ProviderModelInfo,
  providerType: string | undefined
): ProviderModelInfo {
  if (model.apiStyle) return model
  const apiStyle = apiStyleFromProviderType(providerType)
  return apiStyle ? { ...model, apiStyle } : model
}
