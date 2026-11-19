import { createReasoningStrategy, readReasoningEffort } from '../../../models/reasoning-strategy'
import type { ProviderOptions } from '../../../types'

const CLAUDE_EFFORT_MODEL = /(?:^|\/)claude-opus-4-5(?:[.-]|$)/i
const CLAUDE_ADAPTIVE_EFFORT_MODEL = /(?:^|\/)claude-opus-(?:4-[78]|5)(?:[.-]|$)/i

export function isClaudeAdaptiveThinkingModel(modelId: string): boolean {
  return CLAUDE_ADAPTIVE_EFFORT_MODEL.test(modelId)
}

export function usesClaudeEffortControl(modelId: string): boolean {
  return CLAUDE_EFFORT_MODEL.test(modelId) || isClaudeAdaptiveThinkingModel(modelId)
}

export function normalizeClaudeReasoningOptions(
  modelId: string,
  claude: ProviderOptions['claude']
): ProviderOptions['claude'] {
  if (!claude) return undefined
  if (usesClaudeEffortControl(modelId)) {
    if (!claude.effort) return undefined
    // Clamp DeepSeek-Anthropic values to the strongest effort Claude accepts.
    return { effort: claude.effort === 'xhigh' || claude.effort === 'max' ? 'high' : claude.effort }
  }
  if (claude.thinking?.type === 'enabled' && claude.thinking.budgetTokens == null) return undefined
  return claude.thinking ? { thinking: claude.thinking } : undefined
}

export function claudeReasoning(modelId: string) {
  const effort = usesClaudeEffortControl(modelId)
  return createReasoningStrategy({
    off: !effort,
    read(options) {
      if (effort) return readReasoningEffort(options?.claude?.effort)
      const thinking = options?.claude?.thinking
      if (!thinking) return 'default'
      if (thinking.type !== 'enabled') return 'off'
      const budget = thinking.budgetTokens ?? 0
      return budget >= 8192 ? 'high' : budget >= 4096 ? 'medium' : 'low'
    },
    write: (level, previous) => ({
      ...previous,
      claude:
        level === 'off'
          ? { thinking: { type: 'disabled', budgetTokens: 0 } }
          : effort
            ? { effort: level }
            : { thinking: { type: 'enabled', budgetTokens: { low: 1024, medium: 4096, high: 8192 }[level] } },
    }),
  })
}
