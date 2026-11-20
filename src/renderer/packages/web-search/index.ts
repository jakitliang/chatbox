import { createWebSearchService } from '@shared/services/web-search/service'
import type { SearchResultItem } from '@shared/types'
import { truncate } from 'lodash'
import platform from '@/platform'
import { getExtensionSettings, getLanguage } from '@/stores/settingActions'
import { getSearchAcceptLanguage } from './accept-language'
import { getRendererWebSearchProvider } from './provider'
import { rendererSearchRequest } from './transport'

const service = createWebSearchService({
  cacheTtl: 5 * 60 * 1000,
  maxResults: 10,
  formatItem: (item) => ({ ...item, snippet: truncate(item.snippet, { length: 150 }) }),
})

function providerForExecution(settings: Parameters<typeof getRendererWebSearchProvider>[0]) {
  const locale = getLanguage()
  return getRendererWebSearchProvider(settings, {
    request: rendererSearchRequest,
    mobile: platform.type === 'mobile',
    locale,
    acceptLanguage: getSearchAcceptLanguage(locale),
  })
}

export async function testWebSearchConnection(signal?: AbortSignal): Promise<void> {
  const settings = getExtensionSettings().webSearch
  await service.search(settings.provider, providerForExecution(settings), 'Chatbox', {
    signal,
    bypassCache: true,
  })
}

export function checkWebSearchProviderConnection(settings: Parameters<typeof getRendererWebSearchProvider>[0]) {
  return service.checkConnection(providerForExecution(settings))
}

export async function webSearchExecutor({ query }: { query: string }, { abortSignal }: { abortSignal?: AbortSignal }) {
  const settings = getExtensionSettings().webSearch
  const searchResults = await service.search(settings.provider, providerForExecution(settings), query, {
    signal: abortSignal,
  })
  return { query, searchResults }
}

export function getParseLinkProvider() {
  const provider = providerForExecution(getExtensionSettings().webSearch)
  if (!provider.parseLink) return null
  return { parseLink: provider.parseLink.bind(provider) }
}

export type { SearchResultItem }
