import { ChatboxAIAPIError } from '../../models/errors'
import { normalizeSearchHost, useApiKey } from './provider'
import type { ProviderFactory } from './types'

export const createTavily: ProviderFactory = (config, environment) =>
  useApiKey('tavily-api-key', 'tavily_api_key_required', config, environment, (request, headers) => {
    const host = normalizeSearchHost(config.apiHost || 'https://api.tavily.com') || 'https://api.tavily.com'
    const maxResults = config.maxResults
    return {
      cacheScope: host,
      async search(query, signal) {
        const response = await request(
          `${host}/search`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              query,
              search_depth: 'basic',
              include_domains: [],
              exclude_domains: [],
              max_results: maxResults,
            }),
            signal: signal as RequestInit['signal'],
          },
          'json'
        )
        if (!response.ok) throw new Error(`Tavily search failed with status ${response.status}`)
        const payload = (await response.json()) as {
          results?: Array<{ title?: string; url?: string; content?: string }>
        }
        const results = Array.isArray(payload.results) ? payload.results : []
        const items = results.map((item) => ({
          title: item.title ?? '',
          link: item.url ?? '',
          snippet: item.content ?? '',
        }))
        return maxResults === undefined ? items : items.slice(0, maxResults)
      },
      async parseLink(url, signal) {
        const response = await request(
          `${host}/extract`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ urls: [url] }),
            signal: signal as RequestInit['signal'],
          },
          'json'
        )
        if (!response.ok) throw new Error(`Tavily extract failed with status ${response.status}`)
        const payload = (await response.json()) as {
          results?: Array<{ url?: string; raw_content?: string }>
          failed_results?: Array<{ url?: string }>
        }
        const result = payload.results?.[0]
        if (!result) {
          const technical = `Tavily extract API returned no results for ${payload.failed_results?.[0]?.url ?? url}`
          throw ChatboxAIAPIError.fromCodeName(technical, 'parse_link_failed') ?? new Error(technical)
        }
        const resultUrl = result.url?.trim() ? result.url : url
        let title = resultUrl
        try {
          title = new URL(resultUrl).hostname || resultUrl
        } catch {
          // A malformed result URL is still useful as a label.
        }
        return { url: resultUrl, title, content: result.raw_content || '' }
      },
    }
  })
