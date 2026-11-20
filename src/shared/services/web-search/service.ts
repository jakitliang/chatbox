import { cachified, type CacheEntry } from '@epic-web/cachified'
import type { AbortSignalLike } from '../../types/adapters'
import type { SearchResultItem, WebSearchProvider } from './types'

export async function mergeSearchSources(sources: Promise<SearchResultItem[]>[], limit: number) {
  const outcomes = await Promise.allSettled(sources)
  const batches = outcomes.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []))
  if (!batches.length) {
    const failure = outcomes.find((outcome) => outcome.status === 'rejected')
    throw failure?.reason ?? new Error('Web search failed')
  }
  const items: SearchResultItem[] = []
  for (let index = 0; index < Math.max(...batches.map((batch) => batch.length)); index++) {
    for (const batch of batches) {
      if (items.length >= limit) return items
      if (batch[index]) items.push(batch[index])
    }
  }
  return items
}

interface SearchPolicy {
  cacheTtl?: number
  maxResults?: number
  formatItem?: (item: SearchResultItem) => SearchResultItem
}

export function createWebSearchService({ cacheTtl, maxResults, formatItem }: SearchPolicy = {}) {
  const cache = new Map<string, CacheEntry<SearchResultItem[]>>()
  return {
    async search(
      id: string,
      provider: WebSearchProvider,
      query: string,
      { signal, bypassCache }: { signal?: AbortSignalLike; bypassCache?: boolean } = {}
    ) {
      if (signal?.aborted) throw new DOMException('Web search aborted', 'AbortError')
      if (provider.configurationError) throw provider.configurationError
      const run = async () => {
        const items = await provider.search(query, signal)
        if (signal?.aborted) throw new DOMException('Web search aborted', 'AbortError')
        const capped = maxResults === undefined ? items : items.slice(0, maxResults)
        return formatItem ? capped.map(formatItem) : capped
      }
      if (!cacheTtl || bypassCache) return run()
      return cachified({
        cache,
        key: JSON.stringify([id, provider.cacheScope, query]),
        ttl: cacheTtl,
        getFreshValue: run,
      })
    },
    async checkConnection(provider: WebSearchProvider, signal?: AbortSignalLike) {
      if (provider.checkConnection) await provider.checkConnection(signal)
      else await provider.search('Chatbox', signal)
    },
  }
}
