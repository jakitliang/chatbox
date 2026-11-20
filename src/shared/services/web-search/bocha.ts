import { useApiKey } from './provider'
import type { ProviderFactory } from './types'

type BochaPages = { value?: Array<{ name: string; url: string; summary?: string; snippet?: string }> }
interface BochaResponse {
  code?: number | string
  msg?: string | null
  message?: string | null
  data?: { webPages?: BochaPages }
  webPages?: BochaPages
}

const ENDPOINTS = ['https://api.bocha.cn/v1/web-search', 'https://api.bochaai.com/v1/web-search']

export const createBocha: ProviderFactory = (config, environment) =>
  useApiKey('bocha-api-key', 'bocha_api_key_required', config, environment, (request, headers) => ({
    async search(query, signal) {
      let lastError: unknown
      for (const endpoint of ENDPOINTS) {
        if (signal?.aborted) throw lastError ?? new Error('Web search aborted')
        try {
          const response = await request(
            endpoint,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({ query, freshness: 'noLimit', summary: true, count: 10 }),
              signal: signal as RequestInit['signal'],
            },
            'json'
          )
          if (!response.ok) throw new Error(`BoCha API error: ${response.status}`)
          const payload = (await response.json()) as BochaResponse
          if (payload.code != null && Number(payload.code) !== 200) {
            throw new Error(payload.msg || payload.message || `BoCha API error: ${payload.code}`)
          }
          const results = payload.data?.webPages?.value ?? payload.webPages?.value
          if (!Array.isArray(results)) throw new Error('BoCha API malformed payload: webPages.value is not an array')
          return results.map((result) => ({
            title: result.name,
            link: result.url,
            snippet: result.summary || result.snippet || '',
          }))
        } catch (error) {
          lastError = error
        }
      }
      throw lastError ?? new Error('BoCha API request failed on all endpoints')
    },
  }))
