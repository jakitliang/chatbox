export const webSearchProviderIds = ['bing', 'tavily', 'bocha', 'querit', 'searxng'] as const
export type WebSearchProviderId = (typeof webSearchProviderIds)[number]

export const defaultWebSearchProvider = 'bing'

const labels: Record<WebSearchProviderId, string> = {
  bing: 'Bing Search',
  tavily: 'Tavily',
  bocha: 'BoCha',
  querit: 'Querit',
  searxng: 'SearXNG',
}

export const webSearchProviders = webSearchProviderIds.map((id) => ({ id, label: labels[id] }))
