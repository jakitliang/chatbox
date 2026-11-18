import type { ProviderSettings } from '../../types'
import { normalizeOpenAIApiHostAndPath } from '../../utils/llm_utils'
import { getRuntimeContextWindowValue } from '../context-window'
import type { ContextWindowDelegate } from '../types'

function nativeHost(settings: ProviderSettings): string {
  return normalizeOpenAIApiHostAndPath({
    apiHost: settings.apiHost || 'http://127.0.0.1:11434',
  }).apiHost.replace(/\/v1\/?$/, '')
}

function canonicalName(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1).includes(':') ? name : `${name}:latest`
}

/** Only this provider knows about Ollama's loaded-model API. Missing facts remain unknown. */
export const ollamaContextWindowDelegate: ContextWindowDelegate = {
  getContextWindow: getRuntimeContextWindowValue,
  runtime: {
    getCacheKey: (settings) => JSON.stringify([nativeHost(settings), !!settings.useProxy]),
    async resolve(settings, modelId, request, signal) {
      const response = await request(`${nativeHost(settings)}/api/ps`, { useProxy: settings.useProxy, signal })
      if (!response.ok) throw new Error(`Ollama ps request failed: ${response.status}`)
      const payload = await response.json()
      if (!Array.isArray(payload?.models)) return undefined
      let window: number | undefined
      for (const model of payload.models) {
        const length = model?.context_length
        if (!Number.isSafeInteger(length) || length <= 0) continue
        if (
          ![model.name, model.model].some(
            (name) => typeof name === 'string' && canonicalName(name) === canonicalName(modelId)
          )
        )
          continue
        window = Math.min(window ?? length, length)
      }
      return window
    },
  },
}
