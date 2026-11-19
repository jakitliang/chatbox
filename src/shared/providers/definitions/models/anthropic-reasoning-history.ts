import { pickPersistableProviderMetadata } from '../../../models/provider-part-metadata'
import {
  prepareReasoningHistory,
  type ReasoningHistoryInput,
  signedReasoningReplay,
} from '../../../models/reasoning-replay'
import type { MessageContentParts } from '../../../types'
import { usesClaudeEffortControl } from './anthropic-reasoning'

export function prepareAnthropicReasoningHistory(modelId: string, input: ReasoningHistoryInput) {
  const history = prepareReasoningHistory(signedReasoningReplay('anthropic'), input)
  if (input.mode !== 'agent' || !shouldDisableClaudeThinkingForUnsignedResume(input.lastMessage, true, modelId)) {
    return history
  }
  return {
    conversion: { ...history.conversion, preserveReasoning: false as const },
    providerOptions: {
      ...history.providerOptions,
      claude: { ...history.providerOptions?.claude, thinking: { type: 'disabled' as const } },
    },
  }
}

/**
 * Budget-style Claude can send `thinking: { type: 'disabled' }`. Effort /
 * adaptive models cannot express an explicit off on the wire.
 */
export function canSendClaudeThinkingDisabled(modelId: string | undefined): boolean {
  return !!modelId && !usesClaudeEffortControl(modelId)
}

/**
 * Anthropic manual (budget) thinking enforces that the final assistant *turn*
 * of a thinking-enabled request begins with a thinking block. A tool-use loop
 * is one turn, and in non-interleaved mode only the loop's first response
 * carries thinking — later steps legitimately ship bare `tool_use` blocks. The
 * check therefore anchors on the turn start, not on the last tool call:
 * resuming is safe whenever the first block the converter puts on the wire is
 * a signed thinking block, even if later steps in the same turn are unsigned.
 *
 * When the resumed turn cannot open with signed thinking (data saved before
 * signature capture, or a turn minted by another provider), budget-style
 * models turn thinking off for this request instead — the official
 * graceful-degradation path ("To avoid this requirement, disable thinking").
 * The caller must then also drop reasoning replay so the degraded request
 * carries no thinking blocks at all.
 *
 * Effort/adaptive Claude models are exempt by rule, not as a fallback for
 * their missing `thinking: {type: 'disabled'}` wire shape: the turn-start
 * requirement exists only in manual mode ("Adaptive mode relaxes this: no
 * assistant turn needs to start with one"), and these models never receive
 * manual thinking config anyway (normalizeClaudeReasoningOptions keeps only
 * the effort param). An unsigned resume is already a valid request for them —
 * there is nothing to degrade.
 *
 * Anchored on the last prompt message: only a request that ends with an
 * assistant tool exchange (a resumed continuation) is constrained. A fresh
 * user turn ends with the user message, its history needs no thinking blocks
 * ("outside tool use, omit prior turns' thinking"), and must never have its
 * thinking silently degraded by old unsigned turns earlier in the session.
 */
export function shouldDisableClaudeThinkingForUnsignedResume(
  lastPromptMessage: { role: string; contentParts?: MessageContentParts } | undefined,
  /**
   * Whether this request replays Anthropic signed thinking. Callers must pass
   * the route's Anthropic-ness, not merely "signed replay is on": OpenAI
   * Responses also replays signed metadata but has no turn-start rule, and
   * degrading its thinking would silently drop the encrypted reasoning items
   * this request exists to send.
   */
  anthropicSignedReplay: boolean,
  modelId: string
): boolean {
  if (!anthropicSignedReplay || !canSendClaudeThinkingDisabled(modelId)) return false
  if (lastPromptMessage?.role !== 'assistant') return false
  const parts = lastPromptMessage.contentParts ?? []
  // Only completed tool calls reach the wire; without one the request does not
  // end in a resumed tool exchange, so the turn-start rule has nothing to bite.
  if (!parts.some(isWireVisibleToolCall)) return false
  return !turnStartsWithSignedThinking(parts)
}

function isWireVisibleToolCall(part: MessageContentParts[number]): boolean {
  return part.type === 'tool-call' && part.state !== 'call' && part.state !== 'paused'
}

/**
 * Mirrors what `convertToModelMessages` emits under signed-only replay: skips
 * parts that never reach the wire (unsigned reasoning, empty or protocol-only
 * text, unfinished tool calls, info parts) and reports whether the first
 * surviving block is signed thinking.
 *
 * Filtered to the `anthropic` namespace for the same reason the converter is:
 * this only ever runs on Anthropic routes, where a leftover OpenAI reasoning
 * item is dropped rather than emitted, so it must not count as signed thinking.
 */
function turnStartsWithSignedThinking(parts: MessageContentParts): boolean {
  for (const part of parts) {
    switch (part.type) {
      case 'reasoning':
        if (pickPersistableProviderMetadata(part.providerMetadata, ['anthropic'])) return true
        break // unsigned reasoning is omitted from the wire; keep looking
      case 'text':
        if (part.text && !part.protocolOnly) return false
        break
      case 'tool-call':
        if (isWireVisibleToolCall(part)) return false
        break
      case 'image':
        return false
      default:
        break // info/status parts never reach the wire
    }
  }
  return false
}
