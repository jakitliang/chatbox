import { ChatboxAIAPIError } from '../../models/errors'
import type { SearchConfiguration, SearchEnvironment, SearchRequest, WebSearchProvider } from './types'

export function normalizeSearchHost(host = '') {
  return host.trim().replace(/\/+$/, '')
}

export const fetchSearchRequest: SearchRequest = (url, init) => fetch(url, init)

export function authenticatedRequest(apiKey = '') {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

export function requireConfiguration(
  issue: string,
  code: string,
  configured: boolean,
  operations: Omit<WebSearchProvider, 'configurationIssue' | 'configurationError'>
): WebSearchProvider {
  const configurationError = configured ? null : (ChatboxAIAPIError.fromCodeName(code, code) ?? new Error(code))
  const assertConfigured = () => {
    if (configurationError) throw configurationError
  }
  const { search, parseLink, checkConnection } = operations
  return {
    ...operations,
    configurationIssue: configured ? null : issue,
    configurationError,
    async search(...args) {
      assertConfigured()
      return search(...args)
    },
    ...(parseLink && {
      async parseLink(...args: Parameters<NonNullable<WebSearchProvider['parseLink']>>) {
        assertConfigured()
        return parseLink(...args)
      },
    }),
    ...(checkConnection && {
      async checkConnection(...args: Parameters<NonNullable<WebSearchProvider['checkConnection']>>) {
        assertConfigured()
        return checkConnection(...args)
      },
    }),
  }
}

export function useApiKey(
  issue: string,
  code: string,
  config: SearchConfiguration,
  environment: SearchEnvironment,
  operations: (request: SearchRequest, headers: Record<string, string>) => Parameters<typeof requireConfiguration>[3]
) {
  return requireConfiguration(
    issue,
    code,
    Boolean(config.apiKey?.trim()),
    operations(environment.request ?? fetchSearchRequest, authenticatedRequest(config.apiKey))
  )
}
