import type { ProviderModelInfo } from '../types'

export type ModelCapabilityId = NonNullable<ProviderModelInfo['capabilities']>[number] | 'audio'

/** Project configured capabilities for display without persisting derived IDs. */
export function getModelCapabilityIds(
  model: Pick<ProviderModelInfo, 'capabilities' | 'audio'>
): readonly ModelCapabilityId[] {
  const { capabilities = [], audio } = model
  return audio?.input || audio?.speech ? [...capabilities, 'audio'] : capabilities
}

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
        fresh.audio === undefined &&
        fresh.maxContextWindow === undefined &&
        fresh.reasoningEffortLevels === undefined)
    ) {
      return model
    }
    return {
      ...model,
      ...(fresh.capabilities !== undefined ? { capabilities: fresh.capabilities, type: fresh.type ?? model.type } : {}),
      ...(fresh.audio !== undefined ? { audio: fresh.audio } : {}),
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
