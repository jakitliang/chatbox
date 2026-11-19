import { createReasoningStrategy } from '../../../models/reasoning-strategy'
import { isDeepSeekReasoningEffortModel } from '../../../models/utils/deepseek'

export function deepSeekReasoning(modelId: string) {
  const effort = isDeepSeekReasoningEffortModel(modelId)
  return createReasoningStrategy({
    toggle: !effort,
    read(options) {
      const { thinking, reasoningEffort } = options?.deepseek ?? {}
      if (thinking?.type === 'disabled') return 'off'
      if (!effort) return thinking?.type === 'enabled' ? 'high' : 'default'
      if (reasoningEffort === 'low') return 'low'
      if (reasoningEffort === 'high') return 'medium'
      if (reasoningEffort === 'max' || reasoningEffort === 'xhigh') return 'high'
      return 'default'
    },
    write: (level, previous) => ({
      ...previous,
      deepseek:
        level === 'off'
          ? { thinking: { type: 'disabled' } }
          : {
              thinking: { type: 'enabled' },
              ...(effort ? { reasoningEffort: ({ low: 'low', medium: 'high', high: 'max' } as const)[level] } : {}),
            },
    }),
  })
}
