import { fetchSearchRequest } from './provider'
import { mergeSearchSources } from './service'
import type { ProviderFactory, SearchResultItem } from './types'

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
const WEB_URL = 'https://www.bing.com/search'
const NEWS_URL = 'https://www.bing.com/news/infinitescrollajax'

export const createBing: ProviderFactory = (config, environment) => {
  const request = environment.request ?? fetchSearchRequest
  const includeNews = !environment.mobile && environment.locale !== 'zh-Hans'
  const limit = config.maxResults ?? environment.defaultResultLimit ?? 10
  const headers = {
    Accept: HTML_ACCEPT,
    'Accept-Language': environment.acceptLanguage ?? 'en-US,en;q=0.9',
    ...(environment.userAgent && { 'User-Agent': environment.userAgent }),
  }

  async function searchSource(query: string, news: boolean, signal?: RequestInit['signal']) {
    const url = `${news ? NEWS_URL : WEB_URL}?${news ? 'InfiniteScroll=1&' : ''}q=${encodeURIComponent(query)}`
    const response = await request(url, { method: 'GET', headers, signal }, 'text')
    if (!response.ok) throw new Error(`Bing search failed with status ${response.status}`)
    return extractBingResults(await response.text(), news, limit)
  }

  return {
    configurationIssue: null,
    configurationError: null,
    cacheScope: JSON.stringify([headers['Accept-Language'], includeNews, limit]),
    async search(query, signal) {
      const web = searchSource(query, false, signal as RequestInit['signal'])
      if (!includeNews) return web
      return mergeSearchSources([web, searchSource(query, true, signal as RequestInit['signal'])], limit)
    },
  }
}

export async function extractBingResults(html: string, news = false, limit = 10) {
  const { DOMParser } = await import('linkedom/worker')
  const dom = new DOMParser().parseFromString(html, 'text/html')
  const nodes = dom.querySelectorAll(news ? '.newsitem' : '#b_results>li.b_algo')
  return Array.from<Element>(nodes)
    .slice(0, limit)
    .flatMap((node): SearchResultItem[] => {
      const anchor = news ? node.querySelector('.title') : (node.querySelector('h2>a') ?? node.querySelector('a.tilk'))
      const link = anchor?.getAttribute('href')
      if (!link || !anchor) return []
      const title = (news ? anchor.textContent : anchor.getAttribute('aria-label') || anchor.textContent) ?? ''
      if (!title && !news) return []
      const summary = news
        ? node.querySelector('.snippet')
        : (node.querySelector('p[class^="b_lineclamp"]') ?? node.querySelector('.b_caption p'))
      return [{ title, link, snippet: summary?.textContent ?? '' }]
    })
}
