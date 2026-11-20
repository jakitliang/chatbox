import { useApiKey } from './provider'
import type { ProviderFactory } from './types'

const SEARCH_URL = 'https://api.querit.ai/v1/search'

export const createQuerit: ProviderFactory = (config, environment) =>
  useApiKey('querit-api-key', 'querit_api_key_required', config, environment, (request, headers) => {
    const count = config.maxResults ?? 5
    const timeRange = config.timeRange === 'none' ? null : (config.timeRange ?? null)
    async function send(body: object, signal?: RequestInit['signal']) {
      const response = await request(
        SEARCH_URL,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal,
        },
        'json'
      )
      if (!response.ok) throw new Error(`Querit search failed with status ${response.status}`)
      return response
    }
    return {
      cacheScope: JSON.stringify([count, timeRange]),
      async checkConnection(signal) {
        await send({ query: 'Chatbox' }, signal as RequestInit['signal'])
      },
      async search(query, signal) {
        const response = await send(
          {
            query,
            count,
            ...(timeRange && { filters: { timeRange: { date: timeRange } } }),
          },
          signal as RequestInit['signal']
        )
        const payload = (await response.json()) as {
          error_code?: number
          error?: unknown
          results?: { result?: Array<{ title: string; url: string; snippet: string }> }
        }
        if (payload.error_code !== 200) {
          console.error('Querit search API error:', payload.error_code, payload.error)
          return []
        }
        if (!Array.isArray(payload.results?.result)) return []
        return payload.results.result.map(({ title, url, snippet }) => ({ title, link: url, snippet }))
      },
    }
  })
