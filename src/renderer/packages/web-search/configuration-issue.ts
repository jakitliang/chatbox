import { getRendererWebSearchProvider } from './provider'

export function getWebSearchConfigurationIssue(settings: Parameters<typeof getRendererWebSearchProvider>[0]) {
  return getRendererWebSearchProvider(settings).configurationIssue
}
