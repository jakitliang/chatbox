import { createBing } from './web-search/bing'
import { createBocha } from './web-search/bocha'
import { createQuerit } from './web-search/querit'
import { createSearxng } from './web-search/searxng'
import { createTavily } from './web-search/tavily'
import type { ProviderFactory, SearchConfiguration, SearchEnvironment } from './web-search/types'

interface ProviderRegistration {
  label: string
  create: ProviderFactory
  credential?: {
    key: `${string}ApiKey` | `${string}BaseUrl`
    type: 'apiKey' | 'apiHost'
    label: string
    description?: string
    placeholder?: string
    getKeyUrl?: string
  }
  options?: { maxResults: `${string}MaxResults`; timeRange: `${string}TimeRange`; title: string }
  note?: string
}

function register<T extends Record<string, ProviderRegistration>>(
  entries: T
): {
  [K in keyof T]: ProviderRegistration
} {
  return entries
}

// Mark strings for extraction; the settings UI translates them at render time.
const t = (message: string) => message

const registry = register({
  bing: {
    label: 'Bing Search',
    create: createBing,
    note: t('Bing Search is provided for free use, but it may have limitations and is subject to change by Microsoft.'),
  },
  tavily: {
    label: 'Tavily',
    create: createTavily,
    credential: {
      key: 'tavilyApiKey',
      type: 'apiKey',
      label: t('Tavily API Key'),
      getKeyUrl: 'https://app.tavily.com?utm_source=chatbox',
    },
  },
  bocha: {
    label: 'BoCha',
    create: createBocha,
    credential: {
      key: 'bochaApiKey',
      type: 'apiKey',
      label: t('BoCha API Key'),
      getKeyUrl: 'https://open.bochaai.com',
    },
  },
  querit: {
    label: 'Querit',
    create: createQuerit,
    credential: {
      key: 'queritApiKey',
      type: 'apiKey',
      label: t('Querit API Key'),
      placeholder: t('Enter your Querit API Key'),
      getKeyUrl: 'https://www.querit.ai',
    },
    options: { maxResults: 'queritMaxResults', timeRange: 'queritTimeRange', title: t('Querit Search Options') },
  },
  searxng: {
    label: 'SearXNG',
    create: createSearxng,
    credential: {
      key: 'searxngBaseUrl',
      type: 'apiHost',
      label: t('SearXNG Instance URL'),
      description: t('The SearXNG instance must enable JSON output format in search settings.'),
      placeholder: 'https://searx.example.com',
    },
  },
})

export type WebSearchProviderId = keyof typeof registry
export const webSearchProviderIds = Object.keys(registry) as WebSearchProviderId[]
export const defaultWebSearchProvider = 'bing' satisfies WebSearchProviderId
export const webSearchProviders = webSearchProviderIds.map((id) => ({ id, label: registry[id].label }))

export function getWebSearchRegistration(id: WebSearchProviderId) {
  if (!Object.hasOwn(registry, id)) throw new Error(`Unsupported search provider: ${id}`)
  return registry[id]
}

export function createWebSearchProvider(
  id: WebSearchProviderId,
  config: SearchConfiguration,
  env: SearchEnvironment = {}
) {
  return getWebSearchRegistration(id).create(config, env)
}
