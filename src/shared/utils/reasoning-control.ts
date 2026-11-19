import type { ProviderOptions } from '../types'
// 'default' sends no reasoning-related parameters at all (the provider's server-side
// default applies); 'off' force-sends the provider's explicit disable parameters.
export type ReasoningControlLevel = 'default' | 'off' | 'low' | 'medium' | 'high'

/**
 * Session-level storage for reasoning provider options. `providerOptionsByModel`
 * scopes options to the provider+model they were written for, so switching models
 * within a session never sends parameters a different model cannot accept. The
 * legacy shared `providerOptions` field is never read anymore (pre-map sessions
 * simply start from the 'default' level again); writes clear it.
 *
 * The per-model binding also prepares for the planned UI move: thinking levels
 * will be edited from the model picker (an "edit thinking" affordance per model)
 * instead of the input-box control, and that UI needs each model's level stored
 * independently.
 */
export interface ReasoningProviderOptionsSource {
  providerOptions?: ProviderOptions
  providerOptionsByModel?: Record<string, ProviderOptions>
}

export function getReasoningOptionsModelKey(provider: string | undefined, modelId: string | undefined): string {
  return `${provider || ''}:${modelId || ''}`
}

/**
 * Resolves the reasoning provider options that apply to the given provider+model.
 * Options never cross model boundaries — a model without its own map entry gets
 * `undefined` (the 'default' level), not another model's parameters.
 */
export function resolveReasoningProviderOptions(
  source: ReasoningProviderOptionsSource | undefined,
  provider: string | undefined,
  modelId: string | undefined
): ProviderOptions | undefined {
  return source?.providerOptionsByModel?.[getReasoningOptionsModelKey(provider, modelId)]
}

/**
 * Returns the settings patch that stores `next` for the given provider+model.
 * Writes the per-model map (deleting the entry when `next` is undefined, i.e.
 * the 'default' level) and clears the legacy shared field so the map is the
 * single source of truth from then on.
 */
export function setReasoningProviderOptionsForModel(
  source: ReasoningProviderOptionsSource | undefined,
  provider: string | undefined,
  modelId: string | undefined,
  next: ProviderOptions | undefined
): ReasoningProviderOptionsSource {
  const key = getReasoningOptionsModelKey(provider, modelId)
  const byModel: Record<string, ProviderOptions> = { ...source?.providerOptionsByModel }
  if (next) {
    byModel[key] = next
  } else {
    delete byModel[key]
  }
  return { providerOptions: undefined, providerOptionsByModel: byModel }
}

export interface ReasoningControlOption {
  level: ReasoningControlLevel
  label: 'default' | 'off' | 'on' | 'low' | 'medium' | 'high'
}
