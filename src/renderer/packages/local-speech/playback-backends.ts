import { ModelProviderEnum, type ProviderSettings } from '@shared/types'
import { getBuiltInSpeech } from './built-in'
import { createOllamaSpeech } from './ollama'

export const builtInPlaybackId = 'built-in'
export const speechProviderId = ModelProviderEnum.Ollama

export function listSpeechModels(settings?: ProviderSettings) {
  return (settings?.models ?? [])
    .filter((model) => model.audio?.speech)
    .map((model) => ({
      id: `${speechProviderId}:${model.modelId}`,
      modelId: model.modelId,
      label: `Ollama · ${model.nickname || model.modelId}`,
      voices: model.audio?.voices,
    }))
}

export function resolvePlayback(id: string, settings?: ProviderSettings) {
  if (id === builtInPlaybackId) return getBuiltInSpeech().playback
  const model = listSpeechModels(settings).find((candidate) => candidate.id === id)
  if (!settings || !model) return undefined
  return createOllamaSpeech(settings, model.modelId, model.voices ?? [])
}
