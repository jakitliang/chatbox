import { describe, expect, it, vi } from 'vitest'
import {
  formatNativeWebSearchContext,
  hasNativeWebSearchConfiguration,
  normalizeNativeWebSearchSettings,
  searchNativeWeb,
} from './native-web-search'

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

describe('native web search', () => {
  it('detects configuration presence per provider', () => {
    expect(hasNativeWebSearchConfiguration({ provider: 'tavily', apiKey: '' })).toBe(false)
    expect(hasNativeWebSearchConfiguration({ provider: 'tavily', apiKey: '  ' })).toBe(false)
    expect(hasNativeWebSearchConfiguration({ provider: 'tavily', apiKey: 'tvly-key' })).toBe(true)
    expect(hasNativeWebSearchConfiguration({ provider: 'bing', apiKey: '' })).toBe(true)
    expect(hasNativeWebSearchConfiguration({ provider: 'build-in', apiKey: '' })).toBe(false)
    expect(hasNativeWebSearchConfiguration({ provider: 'build-in', apiKey: '' }, 'license-1')).toBe(false)
    expect(hasNativeWebSearchConfiguration({ provider: 'searxng', apiKey: '', apiHost: '' })).toBe(false)
    expect(hasNativeWebSearchConfiguration({ provider: 'searxng', apiKey: '', apiHost: 'https://search.test' })).toBe(
      true
    )
  })

  it('disables built-in search even with an injected origin and credentials', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    await expect(searchNativeWeb('private query', {
      provider: 'build-in', licenseKey: 'secret', chatboxApiOrigin: 'http://127.0.0.1:4567', fetchFn,
    })).rejects.toThrow('built-in web search is disabled')
    await expect(searchNativeWeb('private query', {
      provider: 'build-in',
      get licenseKey(): string { throw new Error('Read credentials') },
      get chatboxApiOrigin(): string { throw new Error('Read origin') },
      get headers(): Record<string, string> { throw new Error('Read headers') },
      get fetchFn(): typeof fetch { throw new Error('Read fetch') },
    })).rejects.toThrow('built-in web search is disabled')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('disables persisted built-in settings without disabling BYOK settings', () => {
    expect(normalizeNativeWebSearchSettings(undefined)).toMatchObject({ provider: 'build-in', enabled: false })
    expect(normalizeNativeWebSearchSettings({ provider: 'build-in', enabled: true })).toMatchObject({ enabled: false })
    expect(normalizeNativeWebSearchSettings({ provider: 'tavily', enabled: true, apiKey: 'key' })).toMatchObject({
      provider: 'tavily', enabled: true, apiKey: 'key',
    })
  })

  it('preserves BoCha and Querit JSON providers', async () => {
    const bochaFetch = mockFetchResponse({ code: 200, data: { webPages: { value: [{ name: 'Doc', url: 'https://doc.test', summary: 'bocha' }] } } })
    await expect(searchNativeWeb('query', { provider: 'bocha', apiKey: 'byok', fetchFn: bochaFetch })).resolves.toEqual([
      { title: 'Doc', link: 'https://doc.test', snippet: 'bocha' },
    ])
    expect(bochaFetch).toHaveBeenCalledWith('https://api.bocha.cn/v1/web-search', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer byok' }),
    }))
    const queritFetch = mockFetchResponse({ error_code: 200, results: { result: [{ title: 'Doc', url: 'https://doc.test', snippet: 'querit' }] } })
    await expect(searchNativeWeb('query', { provider: 'querit', apiKey: 'byok', fetchFn: queritFetch })).resolves.toEqual([
      { title: 'Doc', link: 'https://doc.test', snippet: 'querit' },
    ])
    expect(queritFetch).toHaveBeenCalledWith('https://api.querit.ai/v1/search', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer byok' }),
    }))
  })

  it('extracts bing results without DOMParser', async () => {
    const html = `<ol id="b_results"><li class="b_algo"><h2><a href="https://one.test/page?a=1&amp;b=2">First &amp; Best</a></h2><div class="b_caption"><p>Snippet one</p></div></li><li class="b_algo"><h2><a href="https://two.test">Second<strong> result</strong></a></h2><p class="b_lineclamp2">Snippet two</p></li></ol>`
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => html,
    })) as unknown as typeof fetch
    const items = await searchNativeWeb('chatbox', { provider: 'bing', fetchFn })
    expect(items).toEqual([
      { title: 'First & Best', link: 'https://one.test/page?a=1&b=2', snippet: 'Snippet one' },
      { title: 'Second result', link: 'https://two.test', snippet: 'Snippet two' },
    ])
  })

  it('searches through the tavily-compatible endpoint with an injectable host', async () => {
    const fetchFn = mockFetchResponse({
      results: [
        { title: 'One', url: 'https://one.test', content: 'first snippet' },
        { title: 'Two', url: 'https://two.test', content: 'second snippet' },
        // Link-less results are kept (link: '') and passed to the model, matching the
        // old renderer Tavily provider which returned every result Tavily sent.
        { title: 'No link', content: 'no url' },
      ],
    })
    const items = await searchNativeWeb('chatbox', {
      apiKey: 'key-1',
      apiHost: 'http://10.0.2.2:8091/',
      fetchFn,
    })
    expect(items).toEqual([
      { title: 'One', link: 'https://one.test', snippet: 'first snippet' },
      { title: 'Two', link: 'https://two.test', snippet: 'second snippet' },
      { title: 'No link', link: '', snippet: 'no url' },
    ])
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('http://10.0.2.2:8091/search')
    expect(JSON.parse((init as RequestInit).body as string).query).toBe('chatbox')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer key-1' })
  })

  it('searches a SearXNG JSON endpoint with the configured instance URL', async () => {
    const fetchFn = mockFetchResponse({
      results: [
        { title: 'One', url: 'https://one.test', content: 'first snippet' },
        { title: '', url: 'https://invalid.test', content: 'ignored' },
      ],
    })
    const items = await searchNativeWeb('chatbox mobile', {
      provider: 'searxng',
      apiHost: 'https://search.test/',
      fetchFn,
    })

    expect(items).toEqual([{ title: 'One', link: 'https://one.test', snippet: 'first snippet' }])
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://search.test/search?q=chatbox%20mobile&format=json')
    expect((init as RequestInit).headers).toEqual({ Accept: 'application/json' })
  })

  it('throws on non-ok responses', async () => {
    const fetchFn = mockFetchResponse({}, false, 401)
    await expect(searchNativeWeb('q', { apiKey: 'bad', fetchFn })).rejects.toThrow('status 401')
  })

  it('formats the search context block', () => {
    const context = formatNativeWebSearchContext('chatbox', [
      { title: 'One', link: 'https://one.test', snippet: 'first' },
    ])
    expect(context).toContain('<WEB_SEARCH_RESULTS>')
    expect(context).toContain('query: chatbox')
    expect(context).toContain('https://one.test')
    expect(formatNativeWebSearchContext('chatbox', [])).toBe('')
  })
})
