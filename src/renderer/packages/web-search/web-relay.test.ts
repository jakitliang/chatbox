import { describe, expect, it } from 'vitest'
import { getWebSearchRelayPath } from './web-relay'

describe('Web search relay routing', () => {
  it('only carries the query to a same-origin route', () => {
    expect(getWebSearchRelayPath('https://www.bing.com/search?q=%E5%A4%A9%E6%B0%94%20%26%20news')).toBe(
      '/web-search-relay/search-page?q=%E5%A4%A9%E6%B0%94+%26+news'
    )
    expect(getWebSearchRelayPath('https://www.bing.com/news/infinitescrollajax?InfiniteScroll=1&q=news')).toBe(
      '/web-search-relay/news-page?q=news'
    )
  })

  it.each([
    'http://www.bing.com/search?q=query',
    'https://other.invalid/search?q=query',
    'https://www.bing.com/search?q=query&q=another',
    'https://www.bing.com/search?q=query&url=https://other.invalid',
    'https://api.tavily.com/search?q=query',
  ])('does not forward unregistered targets: %s', (url) => {
    expect(getWebSearchRelayPath(url)).toBeUndefined()
  })
})
