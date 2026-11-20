import type { ProviderModelInfo } from '@shared/types'
import { modelMatchesSearch } from './chatboxCatalog'
import { groupFavorites } from './helpers'
import { ModelRow } from './ModelRow'
import { ProviderRowHeader } from './ProviderRowHeader'
import type { DetailModel, FavoriteModel, FilteredProvider } from './types'

export function GenericProviderRows({
  favoriteOnly,
  favoritedModels,
  genericProviders,
  collapsedProviders,
  search,
  selectedProviderId,
  selectedModelId,
  isMobile,
  modelFilter,
  modelDisabledCheck,
  isFavorited,
  onToggleProvider,
  onSelect,
  onToggleFavorite,
  onShowMobileDetail,
  onDesktopDetailOpen,
  onDesktopDetailClose,
  onDisabledSelect,
}: {
  favoriteOnly: boolean
  favoritedModels?: FavoriteModel[]
  genericProviders: FilteredProvider[]
  collapsedProviders: Record<string, boolean>
  search: string
  selectedProviderId?: string
  selectedModelId?: string
  isMobile: boolean
  modelFilter?: (model: ProviderModelInfo, providerId?: string) => boolean
  modelDisabledCheck?: (model: ProviderModelInfo, providerId?: string) => string | undefined
  isFavorited: (providerId: string, modelId: string) => boolean
  onToggleProvider: (providerId: string) => void
  onSelect: (providerId: string, modelId: string) => void
  onToggleFavorite: (providerId: string, modelId: string) => void
  onShowMobileDetail: (detail: DetailModel) => void
  onDesktopDetailOpen: (key: string, detail: DetailModel, pricingLink: string | undefined, anchor: HTMLElement) => void
  onDesktopDetailClose: () => void
  onDisabledSelect: (modelId: string) => void
}) {
  const source = favoriteOnly
    ? Object.entries(groupFavorites(favoritedModels))
    : genericProviders.map((p) => [p.id, { provider: p, models: [] }] as const)
  const rows = source.map(([_providerId, group]) => {
    const provider = favoriteOnly ? group.provider : (group.provider as FilteredProvider)
    if (!provider) return null
    const collapsed = collapsedProviders[provider.id] || false
    const models = favoriteOnly
      ? group.models
          .map((favorite) => favorite.model)
          .filter((model): model is ProviderModelInfo => {
            if (!model) return false
            if (!modelMatchesSearch({ modelId: model.modelId, modelName: model.nickname }, search, provider.name)) {
              return false
            }
            return modelFilter ? modelFilter(model, provider.id) : !model.type || model.type === 'chat'
          })
      : (provider as FilteredProvider).models || []
    if (models.length === 0) return null
    return (
      <div key={provider.id}>
        <ProviderRowHeader
          provider={provider}
          modelCount={models.length}
          collapsed={collapsed}
          onToggle={() => onToggleProvider(provider.id)}
        />
        {!collapsed &&
          models.map((model) => {
            const disabledReason = modelDisabledCheck?.(model, provider.id)
            const detail: DetailModel = {
              providerId: provider.id,
              providerName: provider.name,
              modelId: model.modelId,
              name: model.nickname || model.modelId,
              capabilities: model.capabilities,
              audio: model.audio,
              disabledReason,
            }
            const detailKey = `${provider.id}/${model.modelId}`
            return (
              <ModelRow
                key={detailKey}
                detail={detail}
                providerModel={model}
                selected={selectedProviderId === provider.id && selectedModelId === model.modelId}
                favorited={isFavorited(provider.id, model.modelId)}
                mobile={isMobile}
                onSelect={() => onSelect(provider.id, model.modelId)}
                onFavorite={() => onToggleFavorite(provider.id, model.modelId)}
                onShowDetail={() => onShowMobileDetail(detail)}
                onDesktopDetailOpen={(anchor) => onDesktopDetailOpen(detailKey, detail, undefined, anchor)}
                onDesktopDetailClose={onDesktopDetailClose}
                onDisabledSelect={() => onDisabledSelect(detail.modelId)}
              />
            )
          })}
      </div>
    )
  })

  if (!rows.some(Boolean)) return null

  return <>{rows}</>
}
