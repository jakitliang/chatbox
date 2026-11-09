import type { ChatboxAILicenseDetail, ProviderModelInfo } from '@shared/types'
import type { ChatboxAIModelList } from '@/packages/remote'

// Historical selector contract only; the commercial provider and remote catalog are removed.
const models: ProviderModelInfo[] = []
export function useRefreshChatboxAIModelsOnLicenseChange(
  _key: string | null | undefined,
  _detail: Partial<ChatboxAILicenseDetail> | null | undefined
): void {}

export default function useChatboxAIModels() {
  return {
    allChatboxAIModels: models, chatboxAIModels: models, chatboxAIImageModels: models,
    chatboxAIModelList: null as ChatboxAIModelList | null, isLoading: false, isFetching: false, error: null,
    refetch: async () => ({ data: undefined }),
  }
}