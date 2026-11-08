import type { AbortSignalLike } from '../types/adapters'

type NativeFetchInit = NonNullable<Parameters<typeof fetch>[1]>
type NativeFetch = (input: string, init?: NativeFetchInit) => Promise<Response>

/**
 * Native-safe web search for the RN mobile shell.
 *
 * Uses JSON HTTP APIs only (no DOMParser/HTML scraping), so it runs on React
 * Native `fetch`. Tavily is the first provider; `apiHost` is injectable so the
 * Android emulator can verify against a local mock without credentials.
 */

export interface NativeWebSearchResultItem {
  title: string
  link: string
  snippet: string
}

/** Same provider set the renderer's Web Search settings expose. */
export type NativeWebSearchProvider = 'build-in' | 'bing' | 'tavily' | 'bocha' | 'querit' | 'searxng'

export const nativeWebSearchProviderOptions: Array<{ id: NativeWebSearchProvider; label: string }> = [
  { id: 'build-in', label: 'Chatbox AI' },
  { id: 'bing', label: 'Bing Search' },
  { id: 'tavily', label: 'Tavily' },
  { id: 'bocha', label: 'BoCha' },
  { id: 'querit', label: 'Querit' },
  { id: 'searxng', label: 'SearXNG' },
]

export interface NativeWebSearchSettings {
  enabled?: boolean
  provider: NativeWebSearchProvider
  apiKey: string
  apiHost: string
}

// Keep the legacy provider value for saved settings, but never enable paid search by default.
export const defaultNativeWebSearchSettings: NativeWebSearchSettings = {
  enabled: false,
  provider: 'build-in',
  apiKey: '',
  apiHost: '',
}

export function normalizeNativeWebSearchSettings(
  settings: Partial<NativeWebSearchSettings> | undefined
): NativeWebSearchSettings {
  const provider = nativeWebSearchProviderOptions.some((option) => option.id === settings?.provider)
    ? (settings?.provider as NativeWebSearchProvider)
    : defaultNativeWebSearchSettings.provider
  return {
    enabled: provider === 'build-in' ? false : settings?.enabled,
    provider,
    apiKey: settings?.apiKey ?? '',
    apiHost: settings?.apiHost ?? '',
  }
}

export interface NativeWebSearchOptions {
  provider?: NativeWebSearchProvider
  apiKey?: string
  apiHost?: string
  /** Legacy compatibility field; the disabled `build-in` provider never reads it. */
  licenseKey?: string
  /** Legacy compatibility field; cannot re-enable the disabled `build-in` provider. */
  chatboxApiOrigin?: string
  signal?: AbortSignalLike
  fetchFn?: NativeFetch
  maxResults?: number
  /** Querit-only knobs (renderer settings webSearch.queritMaxResults / queritTimeRange). */
  queritTimeRange?: string | null
  /** Legacy compatibility field for removed built-in requests. */
  headers?: Record<string, string>
}

const TAVILY_DEFAULT_HOST = 'https://api.tavily.com'
const DEFAULT_MAX_RESULTS = 8

interface TavilyResponseItem {
  title?: string
  url?: string
  content?: string
}

export function hasNativeWebSearchConfiguration(
  settings: Pick<NativeWebSearchSettings, 'provider' | 'apiKey'> & Partial<Pick<NativeWebSearchSettings, 'apiHost'>>,
  _licenseKey?: string
): boolean {
  if (settings.provider === 'build-in') return false
  if (settings.provider === 'tavily' || settings.provider === 'bocha' || settings.provider === 'querit') {
    return Boolean(settings.apiKey.trim())
  }
  if (settings.provider === 'searxng') return Boolean(settings.apiHost?.trim())
  return true // bing needs no credentials
}

export async function searchNativeWeb(
  query: string,
  options: NativeWebSearchOptions
): Promise<NativeWebSearchResultItem[]> {
  const provider = options.provider ?? 'tavily'
  if (provider === 'bing') return searchNativeBing(query, options)
  if (provider === 'build-in') {
    throw new Error('Chatbox AI built-in web search is disabled in the self-hosted edition; select another provider')
  }
  if (provider === 'bocha') return searchNativeBocha(query, options)
  if (provider === 'querit') return searchNativeQuerit(query, options)
  if (provider === 'searxng') return searchNativeSearxng(query, options)
  return searchNativeTavily(query, options)
}

interface SearxngResponseItem {
  title?: unknown
  url?: unknown
  content?: unknown
  snippet?: unknown
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function searchNativeSearxng(
  query: string,
  options: NativeWebSearchOptions
): Promise<NativeWebSearchResultItem[]> {
  const fetchFn = options.fetchFn ?? fetch
  const host = (options.apiHost?.trim() ?? '').replace(/\/+$/, '')
  if (!host) throw new Error('SearXNG instance URL is required')

  const response = await fetchFn(`${host}/search?q=${encodeURIComponent(query)}&format=json`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options.signal as NativeFetchInit['signal'],
  } as NativeFetchInit)
  if (!response.ok) throw new Error(`SearXNG search failed with status ${response.status}`)

  const payload = (await response.json()) as { results?: unknown }
  if (!Array.isArray(payload.results)) throw new Error('SearXNG returned an invalid JSON search response')
  return payload.results
    .filter((item): item is SearxngResponseItem => typeof item === 'object' && item !== null)
    .map((item) => {
      const title = nonEmptyString(item.title)
      const link = nonEmptyString(item.url)
      if (!title || !link) return null
      return {
        title,
        link,
        snippet: nonEmptyString(item.content) ?? nonEmptyString(item.snippet) ?? '',
      }
    })
    .filter((item): item is NativeWebSearchResultItem => item !== null)
}

// BoCha and Querit are plain JSON APIs, shared verbatim with the renderer
// provider shells (packages/web-search/bocha.ts, querit.ts).

interface BochaResponse {
  code?: number | string
  msg?: string | null
  message?: string | null
  data?: { webPages?: { value?: Array<{ name: string; url: string; summary?: string; snippet?: string }> } }
  webPages?: { value?: Array<{ name: string; url: string; summary?: string; snippet?: string }> }
}

const BOCHA_ENDPOINTS = ['https://api.bocha.cn/v1/web-search', 'https://api.bochaai.com/v1/web-search']

async function searchNativeBocha(query: string, options: NativeWebSearchOptions): Promise<NativeWebSearchResultItem[]> {
  const fetchFn = options.fetchFn ?? fetch
  let payload: BochaResponse | undefined
  let lastError: unknown

  for (const endpoint of BOCHA_ENDPOINTS) {
    try {
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.apiKey ?? ''}`,
        },
        body: JSON.stringify({ query, freshness: 'noLimit', summary: true, count: 10 }),
        signal: options.signal as NativeFetchInit['signal'],
      } as NativeFetchInit)
      if (!response.ok) {
        lastError = new Error(`BoCha API error: ${response.status}`)
        continue
      }
      const res = (await response.json()) as BochaResponse
      const responseCode = Number(res.code)
      if (!Number.isNaN(responseCode) && responseCode !== 200) {
        lastError = new Error(res.msg || res.message || `BoCha API error: ${res.code}`)
        continue
      }
      if ((res.code ?? null) !== null && Number.isNaN(responseCode)) {
        lastError = new Error(res.msg || res.message || `BoCha API error: ${res.code}`)
        continue
      }
      const results = res.data?.webPages?.value ?? res.webPages?.value
      if (!Array.isArray(results)) {
        lastError = new Error('BoCha API malformed payload: webPages.value is not an array')
        continue
      }
      payload = res
      break
    } catch (error) {
      lastError = error
    }
  }

  if (!payload) {
    throw lastError || new Error('BoCha API request failed on all endpoints')
  }

  const results = payload.data?.webPages?.value || payload.webPages?.value || []
  return results.map((result) => ({
    title: result.name,
    link: result.url,
    snippet: result.summary || result.snippet || '',
  }))
}

export const QUERIT_SEARCH_URL = 'https://api.querit.ai/v1/search'

async function searchNativeQuerit(
  query: string,
  options: NativeWebSearchOptions
): Promise<NativeWebSearchResultItem[]> {
  const fetchFn = options.fetchFn ?? fetch
  const timeRange = options.queritTimeRange === 'none' ? null : (options.queritTimeRange ?? null)
  const body: { query: string; count: number; filters?: { timeRange: { date: string } } } = {
    query,
    count: options.maxResults ?? 5,
  }
  if (timeRange) {
    body.filters = { timeRange: { date: timeRange } }
  }

  const response = await fetchFn(QUERIT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey ?? ''}`,
    },
    body: JSON.stringify(body),
    signal: options.signal as NativeFetchInit['signal'],
  } as NativeFetchInit)
  if (!response.ok) {
    throw new Error(`Querit search failed with status ${response.status}`)
  }
  const payload = (await response.json()) as {
    error_code?: number
    error?: unknown
    results?: { result?: Array<{ title: string; url: string; snippet: string }> }
  }
  if (payload.error_code !== 200) {
    // Keep the renderer's diagnostic: an HTTP 200 with a business error_code
    // (e.g. invalid/expired key) otherwise yields zero results with no trace.
    console.error('Querit search API error:', payload.error_code, payload.error)
    return []
  }
  if (!payload.results?.result || !Array.isArray(payload.results.result)) {
    return []
  }
  return payload.results.result.map((result) => ({
    title: result.title,
    link: result.url,
    snippet: result.snippet,
  }))
}

async function searchNativeTavily(
  query: string,
  options: NativeWebSearchOptions
): Promise<NativeWebSearchResultItem[]> {
  const fetchFn = options.fetchFn ?? fetch
  const host = (options.apiHost?.trim() || TAVILY_DEFAULT_HOST).replace(/\/+$/, '')
  // Cap is opt-in: the renderer Tavily provider passes no maxResults, preserving the
  // pre-extraction behavior of returning every result Tavily sent (its own server-side
  // default). Native callers can pass maxResults to bound both request and response.
  const maxResults = options.maxResults

  const body: {
    query: string
    search_depth: string
    include_domains: string[]
    exclude_domains: string[]
    max_results?: number
  } = {
    query,
    search_depth: 'basic',
    include_domains: [],
    exclude_domains: [],
  }
  if (maxResults !== undefined) {
    body.max_results = maxResults
  }

  const response = await fetchFn(`${host}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey ?? ''}`,
    },
    body: JSON.stringify(body),
    signal: options.signal as NativeFetchInit['signal'],
  } as NativeFetchInit)
  if (!response.ok) {
    throw new Error(`Web search failed with status ${response.status}`)
  }

  const payload = (await response.json()) as { results?: TavilyResponseItem[] }
  const results = Array.isArray(payload.results) ? payload.results : []
  // No link filtering: matches the old renderer Tavily provider, which returned every
  // result Tavily sent (link-less items included) for the model to use.
  const items = results.map((item) => ({
    title: item.title ?? '',
    link: item.url ?? '',
    snippet: item.content ?? '',
  }))
  return maxResults !== undefined ? items.slice(0, maxResults) : items
}

/**
 * Bing SERP search — the renderer's BingSearch port. React Native has no
 * DOMParser, so the `li.b_algo` items are extracted with tolerant regexes.
 */
async function searchNativeBing(query: string, options: NativeWebSearchOptions): Promise<NativeWebSearchResultItem[]> {
  const fetchFn = options.fetchFn ?? fetch
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS
  const response = await fetchFn(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
    method: 'GET',
    headers: {
      // Bing serves an empty JS shell to non-browser clients (okhttp/CFNetwork),
      // so present a desktop browser. Results are still best-effort.
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: options.signal as NativeFetchInit['signal'],
  } as NativeFetchInit)
  if (!response.ok) {
    throw new Error(`Web search failed with status ${response.status}`)
  }
  const html = await response.text()
  return extractBingResults(html).slice(0, maxResults)
}

export function extractBingResults(html: string): NativeWebSearchResultItem[] {
  const items: NativeWebSearchResultItem[] = []
  const liPattern = /<li class="b_algo[^"]*"[\s\S]*?(?=<li class="b_algo|<\/ol>|$)/g
  for (const block of html.match(liPattern) ?? []) {
    const anchor = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!anchor) continue
    const link = decodeHtmlEntities(anchor[1])
    const title = decodeHtmlEntities(stripTags(anchor[2])).trim()
    if (!link || !title) continue
    const snippetMatch =
      /<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(block) ??
      /<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/.exec(block)
    const snippet = snippetMatch ? decodeHtmlEntities(stripTags(snippetMatch[1])).trim() : ''
    items.push({ title, link, snippet })
  }
  return items
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '')
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
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
