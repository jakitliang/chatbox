import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIApiHostAndPath } from '../../../utils/llm_utils'

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
}