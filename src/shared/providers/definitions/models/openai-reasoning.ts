import {
  createReasoningStrategy,
  type ReasoningStrategy,
  readReasoningEffort,
  stripReasoningProviderOptions,
} from '../../../models/reasoning-strategy'
import type { ProviderOptions } from '../../../types'
import type { ReasoningControlLevel } from '../../../utils/reasoning-control'

const GPT_VERSION_PATTERN = /(?:^|\/)gpt-(\d+)(?=[.-]|$)/i
const OPENAI_NO_REASONING_OPTIONS = /(?:^|\/)o1-(?:preview|mini)(?:-\d{4}-\d{2}-\d{2})?$/i
const OPENAI_NO_DISABLE_MODELS = /(?:^|\/)o[1-9](?:[.-]|$)/i
// The original GPT-5 uses minimal; GPT-5.1 and later GPT-5 variants accept none.
const OPENAI_NONE_EFFORT_MODELS = /(?:^|\/)gpt-5\.[1-9]\d*(?:[.-]|$)/i

function supportsOpenAIThinkingDisable(modelId: string): boolean {
  return Number(GPT_VERSION_PATTERN.exec(modelId)?.[1] ?? 0) <= 5 && !OPENAI_NO_DISABLE_MODELS.test(modelId)
}

function acceptsOpenAIReasoningOptions(modelId: string): boolean {
  return !OPENAI_NO_REASONING_OPTIONS.test(modelId)
}

export function isOpenAIReasoningEffortSupported(modelId: string, effort: string): boolean {
  // max is a DeepSeek-only value, not part of the OpenAI protocol.
  if (!acceptsOpenAIReasoningOptions(modelId) || effort === 'max') return false
  return supportsOpenAIThinkingDisable(modelId) || (effort !== 'minimal' && effort !== 'none')
}

export function normalizeOpenAIReasoningOptions(
  modelId: string,
  openai: ProviderOptions['openai']
): ProviderOptions['openai'] {
  if (!openai || !acceptsOpenAIReasoningOptions(modelId)) return undefined
  if (openai.reasoningEffort !== undefined && !isOpenAIReasoningEffortSupported(modelId, openai.reasoningEffort)) {
    return undefined
  }
  return openai
}

export function getOpenAIReasoningEffort(
  modelId: string,
  level: Exclude<ReasoningControlLevel, 'default'>
): NonNullable<ProviderOptions['openai']>['reasoningEffort'] {
  return level === 'off' ? (OPENAI_NONE_EFFORT_MODELS.test(modelId) ? 'none' : 'minimal') : level
}

type OpenAIReasoningOptions = NonNullable<ProviderOptions['openai']>

export function openAIReasoning(
  modelId: string,
  {
    offEffort,
    onOptions,
  }: {
    offEffort?: 'none'
    onOptions?: Pick<OpenAIReasoningOptions, 'reasoningSummary' | 'include'>
  } = {}
): ReasoningStrategy {
  if (!acceptsOpenAIReasoningOptions(modelId)) {
    return {
      getOptions: () => [],
      readLevel: () => 'default',
      writeOptions: (_level, previous) => stripReasoningProviderOptions(previous),
      normalizeOptions(options) {
        if (!options?.openai) return options
        const next = { ...options }
        delete next.openai
        return Object.keys(next).length ? next : undefined
      },
    }
  }
  return createReasoningStrategy({
    off: offEffort !== undefined || isOpenAIReasoningEffortSupported(modelId, 'none'),
    read: (options) => readReasoningEffort(options?.openai?.reasoningEffort),
    write: (level, previous) => ({
      ...previous,
      openai: {
        reasoningEffort: level === 'off' && offEffort ? offEffort : getOpenAIReasoningEffort(modelId, level),
        forceReasoning: true,
        ...(level !== 'off' ? onOptions : undefined),
      },
    }),
  })
}

export function openAIResponsesReasoning(modelId: string): ReasoningStrategy {
  return openAIReasoning(modelId, {
    onOptions: { reasoningSummary: 'auto', include: ['reasoning.encrypted_content'] },
  })
}

/**
 * Select the OpenAI reasoning options that have a defined OpenAI-compatible wire mapping.
 * `@ai-sdk/openai-compatible` forwards unknown keys verbatim, so OpenAI-only flags such as
 * forceReasoning, reasoningSummary and include must never cross this boundary.
 *
 * Keep this whitelist in sync with the OpenAI option writer.
 * Add a key here only after its compatible request-body mapping is verified.
 */
export function pickOpenAICompatibleReasoningOptions(
  modelId: string,
  providerOptions: ProviderOptions | undefined
): ProviderOptions['openaiCompatible'] {
  const enableThinking = providerOptions?.openaiCompatible?.enable_thinking
  if (enableThinking !== undefined && providerOptions?.openai?.reasoningEffort === undefined) {
    return { enable_thinking: enableThinking }
  }
  const reasoningEffort = providerOptions?.openai?.reasoningEffort ?? providerOptions?.openaiCompatible?.reasoningEffort
  if (reasoningEffort === undefined) return undefined
  if (!isOpenAIReasoningEffortSupported(modelId, reasoningEffort)) return undefined
  return { reasoningEffort }
}

type LegacyOpenAICompatibleReasoning = NonNullable<ProviderOptions['openaiCompatible']>['reasoning']

/**
 * Interprets the legacy `openaiCompatible.reasoning` options (written by older
 * versions) as a DeepSeek-style thinking toggle.
 */
export function getLegacyOpenAICompatibleThinkingType(
  reasoning: LegacyOpenAICompatibleReasoning
): 'enabled' | 'disabled' | undefined {
  if (!reasoning) return undefined
  if (reasoning.enabled === false || reasoning.exclude === true) return 'disabled'
  return reasoning.enabled ? 'enabled' : undefined
}
