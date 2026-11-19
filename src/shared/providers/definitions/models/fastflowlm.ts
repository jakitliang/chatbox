import { ApiError } from '../../../models/errors'
import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import { compatibleBooleanReasoningStrategy } from '../../../models/reasoning-strategy'
import type { CallChatCompletionOptions } from '../../../models/types'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIApiHostAndPath } from '../../../utils/llm_utils'
import type { ReasoningControlOption } from '../../../utils/reasoning-control'
import { validContextWindow } from '../../context-window'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Independent, keyless FLM runtime. Never enters OpenAI's OAuth or Responses paths. */
export default class FastFlowLM extends OpenAICompatible {
  public name = 'FastFlowLM'

  constructor(
    options: Omit<OpenAICompatibleSettings, 'apiKey'>,
    dependencies: ModelDependencies,
    private readonly savedModels: readonly ProviderModelInfo[] = []
  ) {
    // The generic normalizer defaults an empty host to OpenAI. FLM must not.
    if (!options.apiHost.trim()) {
      throw new Error('API host is required')
    }
    const { apiHost } = normalizeOpenAIApiHostAndPath({ apiHost: options.apiHost })
    super({ ...options, apiHost, apiKey: '' }, dependencies)
  }

  public getReasoningOptions(): ReasoningControlOption[] {
    if (!this.isSupportReasoning()) return []
    const options = compatibleBooleanReasoningStrategy.getOptions()
    const levels = this.options.model.reasoningEffortLevels
    if (!levels?.length) return options
    return options.flatMap((option) =>
      option.label === 'on' ? levels.map((level) => ({ level, label: level })) : [option]
    )
  }

  protected getCallSettings(options: CallChatCompletionOptions) {
    const compatible = options.providerOptions?.openaiCompatible
    if (compatible?.enable_thinking === undefined) return super.getCallSettings(options)

    const { enable_thinking: think, ...rest } = compatible
    const openaiCompatible = { ...rest, think }
    return super.getCallSettings({
      ...options,
      providerOptions: { ...options.providerOptions, openaiCompatible },
    })
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    const response = await this.dependencies.request.apiRequest({
      url: `${this.options.apiHost}/models?installed=true&include=capabilities`,
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
      const saved = this.savedModels.find((model) => model.modelId === item.id)
      const model: ProviderModelInfo = { modelId: item.id, type: saved?.type ?? 'chat' }
      if (isRecord(item.flm)) {
        const { vlm, tools, think, reasoning_effort, max_position_embeddings } = item.flm
        const maximum = validContextWindow(max_position_embeddings)
        if (maximum !== undefined) model.maxContextWindow = maximum

        if (Array.isArray(reasoning_effort)) {
          model.reasoningEffortLevels = [
            ...new Set(reasoning_effort.filter((level) => level === 'low' || level === 'medium' || level === 'high')),
          ]
        } else if (
          reasoning_effort === undefined &&
          typeof think === 'boolean' &&
          saved?.reasoningEffortLevels?.length
        ) {
          model.reasoningEffortLevels = []
        }
        // `think: false` rules out a toggle, not reasoning itself.
        const reasoning = think === true || !!model.reasoningEffortLevels?.length
        let capabilities: Set<NonNullable<ProviderModelInfo['capabilities']>[number]> | undefined
        for (const [capability, supported] of [
          ['vision', vlm],
          ['tool_use', tools],
          ['reasoning', reasoning || undefined],
        ] as const) {
          if (typeof supported !== 'boolean') continue
          capabilities ??= new Set(saved?.capabilities)
          if (supported) capabilities.add(capability)
          else capabilities.delete(capability)
        }
        if (capabilities) model.capabilities = [...capabilities]
      }
      models.push(model)
    }
    return models
  }
}
