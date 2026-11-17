import type { ProviderModelInfo } from '../types'
import { refreshProviderModelCapabilities } from './model-config'

/** Native display metadata stays provider-owned; capability refresh uses the common rule. */
export function refreshOllamaModelCapabilities(
	models: ProviderModelInfo[],
	discoveredModels: ProviderModelInfo[]
): ProviderModelInfo[] {
	const discovered = new Map(discoveredModels.map((model) => [model.modelId, model]))
	return refreshProviderModelCapabilities(models, discoveredModels).map((model) => {
		const metadata = discovered.get(model.modelId)?.ollamaDisplayMetadata
		return metadata === undefined ? model : { ...model, ollamaDisplayMetadata: metadata }
	})
}
