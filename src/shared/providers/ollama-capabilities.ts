import type { ProviderModelInfo } from '../types'

/**
 * Refresh facts from the local server without replacing user customization.
 * Unknown native capabilities preserve saved data.
 */
export function refreshOllamaModelCapabilities(
  models: ProviderModelInfo[],
  discoveredModels: ProviderModelInfo[]
): ProviderModelInfo[] {
  const discovered = new Map(discoveredModels.map((model) => [model.modelId, model]))
  return models.map((model) => {
    const fresh = discovered.get(model.modelId)
    return fresh?.capabilities !== undefined
      ? { ...model, capabilities: fresh.capabilities, type: fresh.type ?? model.type }
      : model
  })
}
