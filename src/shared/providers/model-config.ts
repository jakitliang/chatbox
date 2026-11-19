import type { ProviderModelInfo } from '../types'

/** Explicit discovery refresh updates known facts; absent metadata preserves saved choices. */
export function refreshProviderModelCapabilities(
  models: ProviderModelInfo[],
  discoveredModels: ProviderModelInfo[]
): ProviderModelInfo[] {
  const discovered = new Map(discoveredModels.map((model) => [model.modelId, model]))
  return models.map((model) => {
    const fresh = discovered.get(model.modelId)
    if (
      !fresh ||
      (fresh.capabilities === undefined &&
        fresh.maxContextWindow === undefined &&
        fresh.reasoningEffortLevels === undefined)
    ) {
      return model
    }
    return {
      ...model,
      ...(fresh.capabilities !== undefined ? { capabilities: fresh.capabilities, type: fresh.type ?? model.type } : {}),
      ...(fresh.maxContextWindow !== undefined ? { maxContextWindow: fresh.maxContextWindow } : {}),
      ...(fresh.reasoningEffortLevels !== undefined ? { reasoningEffortLevels: fresh.reasoningEffortLevels } : {}),
    }
  })
}

/** Use built-in configuration only when no model configuration has been saved. */
export function mergeProviderModelCapabilities(
  storedModel: ProviderModelInfo | undefined,
  defaultModel: ProviderModelInfo | undefined
): ProviderModelInfo | undefined {
  return storedModel ?? defaultModel
}
