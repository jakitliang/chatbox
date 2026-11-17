import { enrichModelFromRegistry } from '@shared/model-registry/enrich'
import { mergeProviderModelCapabilities } from '@shared/providers/model-config'
import { getProviderDefinition, getSystemProviders } from '@shared/providers/registry'
import type { Settings } from '@shared/types'
import { getRuntimeContextWindow, hasRuntimeContextWindow, refreshRuntimeContextWindow } from './runtime-context-window'

/** Resolve a model's configured context window from provider settings, if any. */
export function getConfiguredContextWindow(
  settings: Pick<Settings, 'providers'>,
  providerId: string | undefined,
  modelId: string | undefined
): number | null | undefined {
  if (!providerId || !modelId) return undefined
  if (hasRuntimeContextWindow(providerId)) {
    return getRuntimeContextWindow(providerId, modelId, settings.providers?.[providerId] ?? {}) ?? null
  }
  return settings.providers?.[providerId]?.models?.find((model) => model.modelId === modelId)?.contextWindow
}

/** Send-time budgets must read the server's currently loaded window, not discovery metadata. */
export async function resolveConfiguredContextWindow(
  settings: Pick<Settings, 'providers'>,
  providerId: string | undefined,
  modelId: string | undefined
): Promise<number | null | undefined> {
  if (providerId && modelId)
    await refreshRuntimeContextWindow(providerId, modelId, settings.providers?.[providerId] ?? {})
  return getConfiguredContextWindow(settings, providerId, modelId)
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
