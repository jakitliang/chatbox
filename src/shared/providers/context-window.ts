import { getRegistryModelMeta, getUnambiguousRegistryModelContextWindow } from '../model-registry/enrich'
import { getProviderDefinition } from './registry'
import { builtinContextWindowPolicies } from './context-window-policies'
import type { ContextWindowDelegate, ContextWindowInput, ContextWindowValue, MaxContextWindowDelegate } from './types'

export { getRuntimeContextWindowValue } from './context-window-policies'

/** Compatibility estimate for providers with no configured or published capacity. */
export const FALLBACK_CONTEXT_WINDOW_TOKENS = 128_000

export function validContextWindow(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

export const defaultMaxContextWindowDelegate: MaxContextWindowDelegate = {
  getMaxContextWindow({ providerId, modelId, model }) {
    const defaults = getProviderDefinition(providerId)?.defaultSettings?.models?.find(
      (item) => item.modelId === modelId
    )
    return (
      validContextWindow(model?.maxContextWindow) ??
      validContextWindow(getRegistryModelMeta(providerId, modelId)?.contextWindow) ??
      validContextWindow(defaults?.maxContextWindow) ??
      validContextWindow(defaults?.contextWindow) ??
      validContextWindow(getUnambiguousRegistryModelContextWindow(modelId)) ??
      validContextWindow(model?.contextWindow)
    )
  },
}

/** Specification lookup never probes a server or fabricates a model maximum. */
export function getMaxContextWindow(input: ContextWindowInput): number | undefined {
  const delegate = getProviderDefinition(input.providerId)?.maxContextWindowDelegate ?? defaultMaxContextWindowDelegate
  return validContextWindow(delegate.getMaxContextWindow(input))
}

export const defaultContextWindowDelegate: ContextWindowDelegate = {
  getContextWindow(input) {
    const configured = validContextWindow(input.model?.contextWindow)
    if (configured !== undefined) return { tokens: configured, source: 'configuration' }
    const maximum = getMaxContextWindow(input)
    if (maximum !== undefined) return { tokens: maximum, source: 'catalog' }
    return { tokens: FALLBACK_CONTEXT_WINDOW_TOKENS, source: 'fallback' }
  },
}

/** All budget consumers use this policy boundary; provider differences stay in delegates. */
export function getContextWindow(input: ContextWindowInput): ContextWindowValue {
  if (!input.modelId) return { tokens: null, source: 'unknown' }
  const delegate =
    getProviderDefinition(input.providerId)?.contextWindowDelegate ??
    builtinContextWindowPolicies[input.providerId] ??
    defaultContextWindowDelegate
  const result = delegate.getContextWindow(input)
  const tokens = validContextWindow(result.tokens) ?? null
  return { tokens, source: tokens === null ? 'unknown' : result.source }
}
