import type { AbortSignalLike } from '../../types/adapters'

export interface SearchResultItem {
  title: string
  link: string
  snippet: string
}

export interface ParseLinkResult {
  url: string
  title: string
  content: string
}

export type SearchRequest = (
  url: string,
  init?: RequestInit,
  responseType?: 'json' | 'text'
) => Promise<Pick<Response, 'ok' | 'status' | 'json' | 'text'>>

export interface SearchEnvironment {
  request?: SearchRequest
  locale?: string
  acceptLanguage?: string
  mobile?: boolean
  defaultResultLimit?: number
  userAgent?: string
}

export interface SearchConfiguration {
  apiKey?: string
  apiHost?: string
  maxResults?: number
  timeRange?: string | null
}

export interface WebSearchProvider {
  configurationIssue: string | null
  configurationError: Error | null
  cacheScope?: string
  search(query: string, signal?: AbortSignalLike): Promise<SearchResultItem[]>
  parseLink?(url: string, signal?: AbortSignalLike): Promise<ParseLinkResult | null>
  checkConnection?(signal?: AbortSignalLike): Promise<void>
}

export type ProviderFactory = (config: SearchConfiguration, environment: SearchEnvironment) => WebSearchProvider
