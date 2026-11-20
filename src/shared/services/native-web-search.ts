import type { AbortSignalLike } from '../types/adapters'
import {
  createWebSearchProvider,
  defaultWebSearchProvider,
  type WebSearchProviderId,
  webSearchProviders,
} from './web-search-providers'
import { createWebSearchService } from './web-search/service'
import type { SearchResultItem } from './web-search/types'

export type NativeWebSearchResultItem = SearchResultItem
export type NativeWebSearchProvider = WebSearchProviderId
export const nativeWebSearchProviderOptions = webSearchProviders
type StoredNativeWebSearchProvider = NativeWebSearchProvider | 'build-in'

export interface NativeWebSearchSettings {
  enabled?: boolean
  provider: NativeWebSearchProvider
  apiKey: string
  apiHost: string
}

export const defaultNativeWebSearchSettings: NativeWebSearchSettings = {
  enabled: false,
  provider: defaultWebSearchProvider,
  apiKey: '',
  apiHost: '',
}

export function normalizeNativeWebSearchSettings(
  settings:
    | (Partial<Omit<NativeWebSearchSettings, 'provider'>> & { provider?: StoredNativeWebSearchProvider })
    | undefined
): NativeWebSearchSettings {
  const provider = nativeWebSearchProviderOptions.find((option) => option.id === settings?.provider)?.id
  return {
    enabled: provider ? settings?.enabled : false,
    provider: provider ?? defaultNativeWebSearchSettings.provider,
    apiKey: settings?.apiKey ?? '',
    apiHost: settings?.apiHost ?? '',
  }
}

export interface NativeWebSearchOptions {
  provider?: StoredNativeWebSearchProvider
  apiKey?: string
  apiHost?: string
  signal?: AbortSignalLike
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>
  maxResults?: number
  queritTimeRange?: string | null
  /** Accepted for compatibility only; never read for the retired built-in provider. */
  licenseKey?: string
  chatboxApiOrigin?: string
  headers?: Record<string, string>
}

const DIRECT_CALL_DEFAULT = 'tavily' satisfies WebSearchProviderId
const NATIVE_SEARCH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export function getNativeWebSearchProvider(options: NativeWebSearchOptions) {
  const id = options.provider ?? DIRECT_CALL_DEFAULT
  if (id === 'build-in') return null
  const { fetchFn } = options
  return createWebSearchProvider(
    id,
    {
      apiKey: options.apiKey,
      apiHost: options.apiHost,
      maxResults: options.maxResults,
      timeRange: options.queritTimeRange,
    },
    {
      request: fetchFn && ((url, init) => fetchFn(url, init)),
      mobile: true,
      defaultResultLimit: 8,
      userAgent: NATIVE_SEARCH_USER_AGENT,
    }
  )
}

export function hasNativeWebSearchConfiguration(
  settings: { provider: StoredNativeWebSearchProvider; apiKey: string; apiHost?: string },
  _licenseKey?: string
): boolean {
  return getNativeWebSearchProvider(settings)?.configurationIssue === null
}

const searchService = createWebSearchService()

export async function searchNativeWeb(
  query: string,
  options: NativeWebSearchOptions
): Promise<NativeWebSearchResultItem[]> {
  const provider = getNativeWebSearchProvider(options)
  if (!provider) throw new Error('The saved web search provider is no longer available; select another provider')
  return searchService.search(options.provider ?? DIRECT_CALL_DEFAULT, provider, query, { signal: options.signal })
}

export function formatNativeWebSearchContext(query: string, items: NativeWebSearchResultItem[]): string {
  if (items.length === 0) return ''
  const entries = items
    .map((item, index) => `${index + 1}. ${item.title}\n${item.link}\n${item.snippet}`.trim())
    .join('\n\n')
  return [
    '<WEB_SEARCH_RESULTS>',
    `The following are web search results for the query: ${query}`,
    'Use them to ground your answer and cite sources by their URLs when relevant.',
    '',
    entries,
    '</WEB_SEARCH_RESULTS>',
  ].join('\n')
}
