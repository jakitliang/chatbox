import { describe, expect, it } from 'vitest'
import { compatibleBooleanReasoningStrategy as strategy } from './reasoning-strategy'

describe('compatible boolean reasoning strategy', () => {
  it.each([undefined, false, true])('normalizes %s directly without an effort or budget', (enabled) => {
    const previous = {
      openai: { reasoningEffort: 'high' as const },
      openaiCompatible: { enable_thinking: enabled, thinking_budget: 8192 },
    }
    const snapshot = structuredClone(previous)
    expect(strategy.normalizeOptions(previous)).toEqual(
      enabled === undefined ? undefined : { openaiCompatible: { enable_thinking: enabled } }
    )
    expect(previous).toEqual(snapshot)
  })

  it('reads legacy budgets as a boolean and clears options when default is selected', () => {
    const previous = { openaiCompatible: { enable_thinking: true, thinking_budget: 1024 } }
    expect(strategy.readLevel(previous)).toBe('high')
    expect(strategy.writeOptions('default', previous)).toBeUndefined()
    expect(strategy.writeOptions('off', previous)).toEqual({ openaiCompatible: { enable_thinking: false } })
    expect(strategy.writeOptions('high', previous)).toEqual({ openaiCompatible: { enable_thinking: true } })
  })
})
