import { enrichModelFromRegistry } from '@shared/model-registry/enrich'
import { mergeProviderModelCapabilities } from '@shared/providers/model-config'
import { getProviderDefinition, getSystemProviders } from '@shared/providers/registry'
import { getContextWindow, getMaxContextWindow } from '@shared/providers/context-window'
import { type ContextWindowOverride, matchContextWindowOverride } from '@shared/providers/context-window-control'
import type { ContextWindowValue } from '@shared/providers/types'
import { getCompactionBudget, type CompactionBudget } from '@chatbox/core/application/token-estimation/math'
import type { Settings } from '@shared/types'
import { getRuntimeContextWindow, refreshRuntimeContextWindow } from './runtime-context-window'

/** Synchronous policy result shared by UI and send-time consumers. */
export function getContextWindowSnapshot(
  settings: Pick<Settings, 'providers'>,
  providerId: string | undefined,
  modelId: string | undefined
): ContextWindowValue {
  if (!modelId) return { tokens: null, source: 'unknown' }
  const providerSettings = providerId ? settings.providers?.[providerId] : undefined
  return getContextWindow({
    providerId: providerId ?? '',
    modelId,
    model: providerSettings?.models?.find((model) => model.modelId === modelId),
    runtimeContextWindow: providerId ? getRuntimeContextWindow(providerId, modelId, providerSettings ?? {}) : undefined,
  })
}

/** Model specification lookup is independent of runtime probing. */
export function getMaximumContextWindow(
  settings: Pick<Settings, 'providers'>,
  providerId: string,
  modelId: string
): number | undefined {
  return getMaxContextWindow({
    providerId,
    modelId,
    model: settings.providers?.[providerId]?.models?.find((model) => model.modelId === modelId),
  })
}

/** Compatibility entry point; all selection and fallback decisions belong to the policy. */
export function getConfiguredContextWindow(
  settings: Pick<Settings, 'providers'>,
  providerId: string | undefined,
  modelId: string | undefined
): number | null | undefined {
  if (!providerId || !modelId) return undefined
  return getContextWindowSnapshot(settings, providerId, modelId).tokens
}

/** Send-time budgets must read the server's currently loaded window, not discovery metadata. */
export async function resolveConfiguredContextWindow(
  settings: Pick<Settings, 'providers'>,
  providerId: string | undefined,
  modelId: string | undefined
): Promise<number | null | undefined> {
  if (providerId && modelId)
    await refreshRuntimeContextWindow(providerId, modelId, settings.providers?.[providerId] ?? {})
  return getContextWindowSnapshot(settings, providerId, modelId).tokens
}

/** Resolve once, then do budget arithmetic without any downstream capacity lookup. */
export async function resolveModelCompactionBudget(
  settings: Pick<Settings, 'providers' | 'compactionThreshold'>,
  providerId: string | undefined,
  modelId: string,
  sessionMaxTokens?: number,
  contextWindowOverride?: ContextWindowOverride
): Promise<CompactionBudget | null> {
  const contextWindow =
    matchContextWindowOverride(contextWindowOverride, providerId, modelId)?.tokens ??
    (await resolveConfiguredContextWindow(settings, providerId, modelId))
  if (contextWindow == null) return null
  return getCompactionBudget(contextWindow, {
    compactionThreshold: settings.compactionThreshold,
    maxOutputTokens: getEffectiveMaxOutputTokens(settings, providerId, modelId, sessionMaxTokens),
  })
}

/** The reply limit a request runs with: the session's max tokens, else the model's max output. */
export function getEffectiveMaxOutputTokens(
  settings: Pick<Settings, 'providers'>,
  providerId: string | undefined,
  modelId: string | undefined,
  sessionMaxTokens: number | undefined
): number | undefined {
  if (sessionMaxTokens !== undefined) return sessionMaxTokens
  if (!providerId || !modelId) return undefined
  const storedModel = settings.providers?.[providerId]?.models?.find((model) => model.modelId === modelId)
  const defaultModel =
    getSystemProviders()
      .find((provider) => provider.id === providerId)
      ?.defaultSettings?.models?.find((model) => model.modelId === modelId) ??
    getProviderDefinition(providerId)?.defaultSettings?.models?.find((model) => model.modelId === modelId)
  const model = mergeProviderModelCapabilities(storedModel, defaultModel) ?? { modelId }
  return enrichModelFromRegistry(model, providerId).maxOutput
}
