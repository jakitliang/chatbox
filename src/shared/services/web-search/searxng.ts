import { fetchSearchRequest, normalizeSearchHost, requireConfiguration } from './provider'
import type { ProviderFactory, SearchResultItem } from './types'

type SearxngItem = { title?: unknown; url?: unknown; content?: unknown; snippet?: unknown }

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export const createSearxng: ProviderFactory = (config, environment) => {
  const host = normalizeSearchHost(config.apiHost)
  const request = environment.request ?? fetchSearchRequest
  return requireConfiguration('searxng-instance', 'searxng_base_url_required', Boolean(host), {
    cacheScope: host,
    async search(query, signal) {
      const response = await request(
        `${host}/search?q=${encodeURIComponent(query)}&format=json`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: signal as RequestInit['signal'],
        },
        'json'
      )
      if (!response.ok) throw new Error(`SearXNG search failed with status ${response.status}`)
      const payload = (await response.json()) as { results?: unknown } | null
      if (!Array.isArray(payload?.results)) throw new Error('SearXNG returned an invalid JSON search response')
      return payload.results.flatMap((item): SearchResultItem[] => {
        if (!item || typeof item !== 'object') return []
        const result: SearxngItem = item
        const title = nonEmptyString(result.title)
        const link = nonEmptyString(result.url)
        if (!title || !link) return []
        return [{ title, link, snippet: nonEmptyString(result.content) ?? nonEmptyString(result.snippet) ?? '' }]
      })
    },
  })
}
