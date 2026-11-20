import { describe, expect, it, vi } from 'vitest'
import { getNativeWebSearchProvider } from '../native-web-search'
import { createWebSearchProvider, webSearchProviderIds } from '../web-search-providers'
import { createWebSearchService } from './service'
import type { SearchRequest } from './types'

describe('shared web search providers', () => {
  it.each(webSearchProviderIds)('constructs %s through the same contract on native and other platforms', (id) => {
    const native = getNativeWebSearchProvider({ provider: id })
    const renderer = createWebSearchProvider(id, {})
    expect(typeof native?.search).toBe('function')
    expect(native?.configurationIssue).toBe(renderer.configurationIssue)
    expect(typeof native?.parseLink).toBe(typeof renderer.parseLink)
  })

  it('advertises page reading before credentials are configured, but does not execute it', async () => {
    const request = vi.fn<SearchRequest>()
    const provider = createWebSearchProvider('tavily', { apiKey: ' ' }, { request })
    expect(provider.parseLink).toBeDefined()
    await expect(provider.parseLink?.('https://example.test')).rejects.toMatchObject({
      message: 'tavily_api_key_required',
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('extracts a page with the same native provider and forwards the signal', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        results: [{ url: 'https://example.test/path', raw_content: 'Page content' }],
      })
    )
    const signal = new AbortController().signal
    const provider = getNativeWebSearchProvider({ provider: 'tavily', apiKey: 'test-key', fetchFn })
    await expect(provider?.parseLink?.('https://example.test/path', signal)).resolves.toEqual({
      url: 'https://example.test/path',
      title: 'example.test',
      content: 'Page content',
    })
    expect(fetchFn).toHaveBeenCalledWith('https://api.tavily.com/extract', expect.objectContaining({ signal }))
  })

  it.each([
    { code: 'ERR_UNKNOWN', msg: 'error' },
    { code: 400, msg: 'error' },
    { code: 200, data: {} },
  ])('tries the next BoCha endpoint when the primary response fails: %j', async (payload) => {
    const request = vi
      .fn<SearchRequest>()
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(
        Response.json({
          code: 200,
          data: { webPages: { value: [{ name: 'Result', url: 'https://example.test', summary: 'Snippet' }] } },
        })
      )
    const provider = createWebSearchProvider('bocha', { apiKey: 'test-key' }, { request })
    await expect(provider.search('query')).resolves.toEqual([
      { title: 'Result', link: 'https://example.test', snippet: 'Snippet' },
    ])
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      'https://api.bocha.cn/v1/web-search',
      'https://api.bochaai.com/v1/web-search',
    ])
  })

  it.each(['<html>login</html>', {}, { results: { title: 'not an array' } }, null])(
    'rejects malformed SearXNG responses: %j',
    async (payload) => {
      const request = vi.fn<SearchRequest>().mockResolvedValue(Response.json(payload))
      const provider = createWebSearchProvider('searxng', { apiHost: ' https://searx.test/ ' }, { request })
      await expect(provider.search('test query')).rejects.toThrow('invalid JSON search response')
      expect(request.mock.calls[0]?.[0]).toBe('https://searx.test/search?q=test%20query&format=json')
    }
  )

  it('accepts empty SearXNG results and falls back from content to snippet', async () => {
    const request = vi
      .fn<SearchRequest>()
      .mockResolvedValueOnce(Response.json({ results: [] }))
      .mockResolvedValueOnce(Response.json({ results: [{ title: 'Doc', url: 'https://doc.test', snippet: 'text' }] }))
    const provider = createWebSearchProvider('searxng', { apiHost: 'https://searx.test' }, { request })
    await expect(provider.search('empty')).resolves.toEqual([])
    await expect(provider.search('snippet')).resolves.toEqual([
      { title: 'Doc', link: 'https://doc.test', snippet: 'text' },
    ])
  })

  it('merges Bing sources without exposing news as a separate provider and retains partial success', async () => {
    const web = '<ol id="b_results"><li class="b_algo"><h2><a href="https://web.test">Web</a></h2></li></ol>'
    const news = '<div class="newsitem"><a class="title" href="https://news.test">News</a></div>'
    const request = vi
      .fn<SearchRequest>()
      .mockResolvedValueOnce(new Response(web))
      .mockResolvedValueOnce(new Response(news))
      .mockResolvedValueOnce(new Response(web))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(web))
    const desktop = createWebSearchProvider('bing', {}, { request, locale: 'en' })
    const native = createWebSearchProvider('bing', {}, { request, mobile: true })
    await expect(desktop.search('query')).resolves.toMatchObject([{ title: 'Web' }, { title: 'News' }])
    await expect(desktop.search('query')).resolves.toMatchObject([{ title: 'Web' }])
    await expect(native?.search('query')).resolves.toMatchObject([{ title: 'Web' }])
    expect(request).toHaveBeenCalledTimes(5)
  })

  it('does not make a request for a search that was already cancelled', async () => {
    const request = vi.fn<SearchRequest>()
    const provider = createWebSearchProvider('bing', {}, { request })
    const controller = new AbortController()
    controller.abort()
    await expect(
      createWebSearchService().search('bing', provider, 'query', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).not.toHaveBeenCalled()
  })
})
