import type { SessionSettings } from '@shared/types'
import { useProviders } from '@/hooks/useProviders'

interface SelectedModel {
  provider: string
  modelId: string
}

export function useModelToolCapabilities(
  model: SelectedModel | undefined,
  _currentSessionMergedSettings: SessionSettings
) {
  const { providers } = useProviders()
  const configuredModel = providers
    .find((provider) => provider.id === model?.provider)
    ?.models?.find((candidate) => candidate.modelId === model?.modelId)
  const supportsTools = configuredModel?.capabilities?.includes('tool_use') ?? false

  return {
    modelSupportsAgentMode: model ? supportsTools : true,
    modelSupportToolUseForFile: supportsTools,
    isModelToolCapabilityFetched: Boolean(model),
    isModelToolCapabilityLoading: false,
    isModelToolCapabilityError: false,
  }
}
