import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { ImageModelGroup } from '@/hooks/useImageModelGroups'
import { getLocalImageModels, LOCAL_IMAGE_BACKEND_ID } from '@/packages/local-image-backend'
import { useLocalImageBackendStore } from '@/stores/localImageBackendStore'

/** Only explicitly validated, saved addresses are eligible for automatic discovery. */
export function useLocalImageModels() {
  const url = useLocalImageBackendStore((state) => state.url)
  const query = useQuery({
    queryKey: ['local-image-models', url],
    queryFn: ({ signal }) => getLocalImageModels(url, signal),
    enabled: !!url,
    retry: false,
    staleTime: 30_000,
  })
  const group = useMemo<ImageModelGroup | undefined>(() => {
    if (!url || !query.data?.models.length) return undefined
    return {
      providerId: LOCAL_IMAGE_BACKEND_ID,
      label: 'Local SDAPI',
      isCustom: true,
      models: query.data.models.map((model) => ({
        modelId: model.id,
        displayName: model.name,
        description: model.description,
        capabilities: model.capabilities,
      })),
    }
  }, [url, query.data])
  return { ...query, group }
}