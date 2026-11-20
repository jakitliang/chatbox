import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the settings actions before importing the module under test
vi.mock('@/stores/settingActions', () => ({
  getExtensionSettings: vi.fn(),
  getLanguage: vi.fn(() => 'en'),
}))

vi.mock('./transport', () => ({
  rendererSearchRequest: vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('https://www.bing.com')) {
      const html = url.includes('/news/')
        ? ''
        : '<ol id="b_results"><li class="b_algo"><h2><a href="https://example.com">Bing Result</a></h2></li></ol>'
      return new Response(html)
    }
    if (url.startsWith('https://api.tavily.com')) {
      if (new Headers(init?.headers).get('authorization') === 'Bearer failing-key')
        throw new Error('Tavily unavailable')
      return Response.json({ results: [{ title: 'Tavily Result', url: 'https://example.com', content: 'test' }] })
    }
    return Response.json({ results: [{ title: `SearXNG Result ${new URL(url).origin}`, url: 'https://example.com' }] })
  }),
}))

import { getExtensionSettings } from '@/stores/settingActions'
import { testWebSearchConnection, webSearchExecutor } from './index'
import { rendererSearchRequest } from './transport'

const mockGetExtensionSettings = vi.mocked(getExtensionSettings)

describe('webSearchExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns different results for different providers with same query', async () => {
    // First call with bing
    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'bing', tavilyApiKey: '' },
    } as ReturnType<typeof getExtensionSettings>)

    const bingResult = await webSearchExecutor({ query: 'test query' }, {})
    expect(bingResult.searchResults).toHaveLength(1)
    expect(bingResult.searchResults[0].title).toBe('Bing Result')

    // Same query but different provider should NOT return cached bing results
    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'tavily', tavilyApiKey: 'test-key' },
    } as ReturnType<typeof getExtensionSettings>)

    const tavilyResult = await webSearchExecutor({ query: 'test query' }, {})
    expect(tavilyResult.searchResults).toHaveLength(1)
    expect(tavilyResult.searchResults[0].title).toBe('Tavily Result')
  })

  it('returns cached results for same provider and query', async () => {
    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'bing', tavilyApiKey: '' },
    } as ReturnType<typeof getExtensionSettings>)

    const result1 = await webSearchExecutor({ query: 'cached query' }, {})
    const requestCount = vi.mocked(rendererSearchRequest).mock.calls.length
    const result2 = await webSearchExecutor({ query: 'cached query' }, {})

    // Both should return same results (cached)
    expect(result1.searchResults).toEqual(result2.searchResults)
    expect(rendererSearchRequest).toHaveBeenCalledTimes(requestCount)
  })

  it('uses a distinct cache key for the SearXNG provider', async () => {
    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'searxng', searxngBaseUrl: 'https://searx.example.com' },
    } as ReturnType<typeof getExtensionSettings>)

    const searxngResult = await webSearchExecutor({ query: 'searxng query' }, {})

    expect(searxngResult.searchResults).toHaveLength(1)
    expect(searxngResult.searchResults[0].title).toBe('SearXNG Result https://searx.example.com')
  })

  it('does not reuse cache when the SearXNG instance URL changes', async () => {
    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'searxng', searxngBaseUrl: 'https://searx-a.example.com/' },
    } as ReturnType<typeof getExtensionSettings>)

    const first = await webSearchExecutor({ query: 'instance query' }, {})
    expect(first.searchResults[0].title).toBe('SearXNG Result https://searx-a.example.com')

    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'searxng', searxngBaseUrl: 'https://searx-b.example.com' },
    } as ReturnType<typeof getExtensionSettings>)

    const second = await webSearchExecutor({ query: 'instance query' }, {})
    expect(second.searchResults[0].title).toBe('SearXNG Result https://searx-b.example.com')
  })

  it('reuses cache when the same SearXNG instance is written with a trailing slash', async () => {
    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'searxng', searxngBaseUrl: 'https://searx-cache.example.com/' },
    } as ReturnType<typeof getExtensionSettings>)

    const first = await webSearchExecutor({ query: 'normalized instance query' }, {})

    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'searxng', searxngBaseUrl: 'https://searx-cache.example.com' },
    } as ReturnType<typeof getExtensionSettings>)

    const second = await webSearchExecutor({ query: 'normalized instance query' }, {})
    expect(second.searchResults).toEqual(first.searchResults)
  })

  it('rejects a whitespace-only SearXNG instance URL', async () => {
    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'searxng', searxngBaseUrl: '   ' },
    } as ReturnType<typeof getExtensionSettings>)

    await expect(webSearchExecutor({ query: 'missing url' }, {})).rejects.toMatchObject({
      code: 20036,
    })
  })

  it('propagates the provider error when every configured provider fails', async () => {
    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'tavily', tavilyApiKey: 'failing-key' },
    } as ReturnType<typeof getExtensionSettings>)

    await expect(webSearchExecutor({ query: 'provider failure' }, {})).rejects.toThrow('Tavily unavailable')
  })
})

describe('testWebSearchConnection', () => {
  it('checks current credentials even when a successful query is cached', async () => {
    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'tavily', tavilyApiKey: 'working-key' },
    } as ReturnType<typeof getExtensionSettings>)
    await webSearchExecutor({ query: 'Chatbox' }, {})
    await expect(testWebSearchConnection()).resolves.toBeUndefined()

    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'tavily', tavilyApiKey: 'failing-key' },
    } as ReturnType<typeof getExtensionSettings>)
    await expect(testWebSearchConnection()).rejects.toThrow('Tavily unavailable')
  })
})
