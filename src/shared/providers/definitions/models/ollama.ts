import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIApiHostAndPath } from '../../../utils/llm_utils'

interface OllamaOptions extends OpenAICompatibleSettings {
  ollamaHost: string
}

function applyNativeCapabilities(model: ProviderModelInfo, capabilities: unknown) {
  if (!Array.isArray(capabilities)) return

  // Empty metadata is authoritative; absent metadata must remain unknown.
  model.capabilities = []
  if (capabilities.includes('tools')) model.capabilities.push('tool_use')
  if (capabilities.includes('vision')) model.capabilities.push('vision')
  if (capabilities.includes('thinking')) model.capabilities.push('reasoning')
  model.type = capabilities.includes('embedding') && !capabilities.includes('completion') ? 'embedding' : 'chat'
}

export default class Ollama extends OpenAICompatible {
  public name = 'Ollama'
  public options: OllamaOptions

  constructor(options: Omit<OllamaOptions, 'apiKey' | 'apiHost'>, dependencies: ModelDependencies) {
    const apiHost = normalizeOpenAIApiHostAndPath({ apiHost: options.ollamaHost }).apiHost
    super(
      {
        apiKey: 'ollama',
        apiHost,
        model: options.model,
        temperature: options.temperature,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
        stream: options.stream,
        useProxy: options.useProxy,
      },
      dependencies
    )
    this.options = {
      ...options,
      apiKey: 'ollama',
      apiHost,
    }
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    // Chat uses the OpenAI-compatible /v1 endpoint; discovery must use the
    // native API. Keep any reverse-proxy path prefix in the configured host.
    const apiHost = this.options.apiHost.replace(/\/v1\/?$/, '')
    try {
      const response = await this.dependencies.request.apiRequest({
        url: `${apiHost}/api/tags`,
        method: 'GET',
        useProxy: this.options.useProxy,
      })
      if (!response.ok) throw new Error(`Ollama tags request failed: ${response.status}`)
      const json = await response.json()
      if (!Array.isArray(json.models)) return []

      return await Promise.all(
        json.models.map(async (item: { name: string; capabilities?: string[] }): Promise<ProviderModelInfo> => {
          const model: ProviderModelInfo = { modelId: item.name, type: 'chat' }
          // Some native servers include capabilities in /api/tags as well.
          // Retain them if /api/show is unavailable or omits this field.
          applyNativeCapabilities(model, item.capabilities)
          try {
            const response = await this.dependencies.request.apiRequest({
              url: `${apiHost}/api/show`,
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: item.name }),
              useProxy: this.options.useProxy,
            })
            if (!response.ok) throw new Error(`Ollama show request failed: ${response.status}`)
            const details = await response.json()
            applyNativeCapabilities(model, details.capabilities)
          } catch (error) {
            // A missing/unavailable model must not hide the rest of the catalog.
            console.error('Failed to fetch Ollama model capabilities', item.name, error)
          }
          return model
        })
      )
    } catch (error) {
      console.error('Failed to fetch Ollama models', error)
      return []
    }
  }
}
