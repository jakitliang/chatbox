import { createWebSearchProvider, getWebSearchRegistration } from '@shared/services/web-search-providers'
import type { SearchConfiguration, SearchEnvironment } from '@shared/services/web-search/types'
import type { WebSearchProviderValue } from './constants'

type RendererSearchSettings = { provider: WebSearchProviderValue } & Record<string, unknown>

export function getRendererWebSearchProvider(settings: RendererSearchSettings, environment?: SearchEnvironment) {
  const { credential, options } = getWebSearchRegistration(settings.provider)
  const config: SearchConfiguration = {}
  if (credential) {
    const value = settings[credential.key]
    if (typeof value === 'string') config[credential.type] = value
  }
  if (options) {
    const maxResults = settings[options.maxResults]
    const timeRange = settings[options.timeRange]
    if (typeof maxResults === 'number') config.maxResults = maxResults
    if (typeof timeRange === 'string') config.timeRange = timeRange
  }

  return createWebSearchProvider(settings.provider, config, environment)
}
