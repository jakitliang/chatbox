import { ApiError } from '../../../models/errors'
import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIApiHostAndPath } from '../../../utils/llm_utils'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/** Independent, keyless FLM runtime. Never enters OpenAI's OAuth or Responses paths. */
export default class FastFlowLM extends OpenAICompatible {
  public name = 'FastFlowLM'

  constructor(options: Omit<OpenAICompatibleSettings, 'apiKey'>, dependencies: ModelDependencies) {
    // The generic normalizer defaults an empty host to OpenAI. FLM must not.
    if (!options.apiHost.trim()) {
      throw new Error('API host is required')
    }
    const { apiHost } = normalizeOpenAIApiHostAndPath({ apiHost: options.apiHost })
    super({ ...options, apiHost, apiKey: '' }, dependencies)
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    const response = await this.dependencies.request.apiRequest({
      url: `${this.options.apiHost}/models`,
      method: 'GET',
      headers: {},
      useProxy: this.options.useProxy,
    })
    if (!response.ok) throw new ApiError('FastFlowLM models request failed', undefined, response.status)
    const payload: unknown = await response.json()
    if (!isRecord(payload) || !Array.isArray(payload.data)) throw new ApiError('Invalid FastFlowLM model catalog')

    const models: ProviderModelInfo[] = []
    for (const item of payload.data) {
      if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim()) continue
      const model: ProviderModelInfo = { modelId: item.id, type: 'chat' }
      if (item.type === 'embedding' || item.type === 'rerank' || item.type === 'image') model.type = item.type
      if (Array.isArray(item.capabilities)) {
        // Native metadata initializes the existing capability checkboxes, not runtime name-based rules.
        model.capabilities = []
        if (item.capabilities.includes('vision')) model.capabilities.push('vision')
        if (item.capabilities.includes('thinking')) model.capabilities.push('reasoning')
        if (item.capabilities.includes('tools')) model.capabilities.push('tool_use')
        if (
          item.type === undefined &&
          item.capabilities.includes('embedding') &&
          !item.capabilities.includes('completion')
        ) {
          model.type = 'embedding'
        }
      }

      const info = isRecord(item.model_info) ? item.model_info : undefined
      const architecture = info?.['general.architecture']
      const capacity = isRecord(item.context_capacity) ? item.context_capacity : undefined
      // Catalog limits are descriptive. The runtime delegate alone supplies compaction windows.
      const contextWindow =
        positiveInteger(item.model_context_length) ??
        (typeof architecture === 'string' ? positiveInteger(info?.[`${architecture}.context_length`]) : undefined) ??
        positiveInteger(capacity?.max)
      if (contextWindow !== undefined) model.maxContextWindow = contextWindow
      models.push(model)
    }
    return models
  }
}
