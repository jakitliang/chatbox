import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import {
  compatibleBooleanReasoningStrategy,
  type ReasoningStrategy,
  stripReasoningProviderOptions,
} from '../../../models/reasoning-strategy'
import type { CallChatCompletionOptions } from '../../../models/types'
import type { ProviderModelInfo, ProviderOptions } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIApiHostAndPath } from '../../../utils/llm_utils'
import {
  isStandardReasoningEffort,
  type ReasoningControlLevel,
  type ReasoningControlOption,
} from '../../../utils/reasoning-control'

interface OllamaOptions extends OpenAICompatibleSettings {
  ollamaHost: string
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
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

function applyThinkingMetadata(model: ProviderModelInfo, thinking: { values?: unknown } | undefined) {
  if (!Array.isArray(thinking?.values)) return
  const values = thinking.values.filter(
    (value): value is string | boolean => typeof value === 'boolean' || (typeof value === 'string' && !!value.trim())
  )
  if (!values.length) return

  // The compatibility endpoint reserves "none" for off.
  const levels = [...new Set(values.filter((value): value is string => typeof value === 'string' && value !== 'none'))]
  model.reasoningEffortLevels = levels
  if (levels.length || values.includes(true)) {
    model.capabilities = [...new Set([...(model.capabilities ?? []), 'reasoning' as const])]
  } else {
    model.capabilities = model.capabilities?.filter((capability) => capability !== 'reasoning') ?? []
  }
}

export default class Ollama extends OpenAICompatible {
  protected usesFixedSampling() {
    return false
  }

  protected getCallSettings(options: CallChatCompletionOptions) {
    const compatible = options.providerOptions?.openaiCompatible
    if (
      options.contextWindowOverride &&
      this.options.contextWindowControl &&
      !this.options.model.reasoningEffortLevels?.length &&
      compatible?.reasoningEffort === 'high'
    ) {
      const { reasoningEffort: _, ...rest } = compatible
      return super.getCallSettings({
        ...options,
        providerOptions: { ...options.providerOptions, openaiCompatible: { ...rest, enable_thinking: true } },
      })
    }
    return super.getCallSettings(options)
  }

  protected getReasoningStrategy(): ReasoningStrategy {
    const levels = this.options.model.reasoningEffortLevels
    const menu: (ReasoningControlOption & { effort?: string })[] = compatibleBooleanReasoningStrategy
      .getOptions()
      .flatMap((option): (ReasoningControlOption & { effort?: string })[] => {
        if (option.label === 'off') return [{ ...option, effort: 'none' }]
        if (option.label !== 'on') return [option]
        if (!levels?.length) return [{ ...option, effort: 'high' }]
        return levels.map((effort) => {
          const level: ReasoningControlLevel = isStandardReasoningEffort(effort) ? effort : `effort:${effort}`
          return { level, label: level, effort }
        })
      })

    function readLevel(options?: ProviderOptions): ReasoningControlLevel {
      const { reasoningEffort, enable_thinking } = options?.openaiCompatible ?? {}
      // Older sessions stored a boolean. Reuse it only where there is a matching choice.
      const effort = reasoningEffort ?? (enable_thinking === undefined ? undefined : enable_thinking ? 'high' : 'none')
      return menu.find((option) => option.effort === effort)?.level ?? 'default'
    }

    function writeOptions(level: ReasoningControlLevel, previous?: ProviderOptions): ProviderOptions | undefined {
      const next = stripReasoningProviderOptions(previous)
      const effort = menu.find((option) => option.level === level)?.effort
      return effort === undefined ? next : { ...next, openaiCompatible: { reasoningEffort: effort } }
    }

    return {
      getOptions: () => menu.map(({ level, label }) => ({ level, label })),
      readLevel,
      writeOptions,
      normalizeOptions: (options) => writeOptions(readLevel(options), options),
    }
  }

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
            applyThinkingMetadata(model, details.thinking)

            const info = details.model_info
            const architecture = info?.['general.architecture']
            // Match the exact architecture key, not rope.scaling.original_context_length.
            const maximum =
              typeof architecture === 'string' ? positiveInteger(info?.[`${architecture}.context_length`]) : undefined
            if (maximum !== undefined) model.maxContextWindow = maximum
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
