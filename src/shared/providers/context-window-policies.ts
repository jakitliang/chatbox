import type { ContextWindowDelegate, ContextWindowInput, ContextWindowValue } from './types'

/** Lightweight policies also work in portable hosts without loading any chat model implementations. */
export function getRuntimeContextWindowValue(input: ContextWindowInput): ContextWindowValue {
  const value = input.runtimeContextWindow
  const tokens = typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
  return { tokens, source: tokens === null ? 'unknown' : 'runtime' }
}

export const runtimeContextWindowPolicy: ContextWindowDelegate = {
  getContextWindow: getRuntimeContextWindowValue,
}

/** Explicit provider strategies, not protocol detection or host/name heuristics. */
export const builtinContextWindowPolicies: Readonly<Record<string, ContextWindowDelegate>> = {
  ollama: runtimeContextWindowPolicy,
  fastflowlm: runtimeContextWindowPolicy,
}
