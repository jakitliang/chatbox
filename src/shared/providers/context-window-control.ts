import { getMaxContextWindow } from './context-window'
import { contextWindowTiers, type ContextWindowTier } from './context-window-tier'
import { getProviderDefinition } from './registry'
import type { ContextWindowInput } from './types'
import type { SessionSettings, Settings } from '../types'

export { contextWindowTiers, type ContextWindowTier } from './context-window-tier'

export interface ContextWindowOverride {
  readonly providerId: string
  readonly modelId: string
  readonly tokens: number
}

export interface ContextWindowControl {
  getTarget(maxTokens: number, tier: ContextWindowTier): number | undefined
  wrapFetch(fetch: typeof globalThis.fetch, tokens: number): typeof globalThis.fetch
}

export function getQuarterContextTarget(maxTokens: number, tier: ContextWindowTier): number | undefined {
  const index = contextWindowTiers.indexOf(tier)
  return index > 0 ? Math.max(1, Math.floor(maxTokens * (index / (contextWindowTiers.length - 1)))) : undefined
}

export function getContextWindowSelection(input: ContextWindowInput) {
  const control = getProviderDefinition(input.providerId)?.contextWindowDelegate?.control
  if (!control) return undefined
  const maxTokens = getMaxContextWindow(input)
  if (maxTokens === undefined) return undefined
  return { maxTokens, getTarget: (tier: ContextWindowTier) => control.getTarget(maxTokens, tier) }
}

export function resolveSessionContextWindowOverride(
  settings: SessionSettings,
  globalSettings: Pick<Settings, 'providers' | 'defaultChatModel'>,
  snapshot?: ContextWindowOverride | null
): ContextWindowOverride | undefined {
  const providerId = settings.provider ?? globalSettings.defaultChatModel?.provider
  const modelId = settings.modelId ?? globalSettings.defaultChatModel?.model
  if (snapshot !== undefined) return matchContextWindowOverride(snapshot ?? undefined, providerId, modelId)
  const tier = settings.contextWindowTier
  if (!providerId || !modelId || !tier || tier === 'default') return undefined
  const tokens = getContextWindowSelection({
    providerId,
    modelId,
    model: globalSettings.providers?.[providerId]?.models?.find((model) => model.modelId === modelId),
  })?.getTarget(tier)
  return tokens ? { providerId, modelId, tokens } : undefined
}

export function matchContextWindowOverride(
  override: ContextWindowOverride | undefined,
  providerId: string | undefined,
  modelId: string | undefined
): ContextWindowOverride | undefined {
  return override &&
    override.providerId === providerId &&
    override.modelId === modelId &&
    Number.isSafeInteger(override.tokens) &&
    override.tokens > 0 &&
    getProviderDefinition(override.providerId)?.contextWindowDelegate?.control
    ? override
    : undefined
}
