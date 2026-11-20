import { type WebSearchProviderId, webSearchProviders } from '@shared/services/web-search-providers'

export const WEB_SEARCH_PROVIDERS = webSearchProviders.map(({ id, label }) => ({ value: id, label }))
export type WebSearchProviderValue = WebSearchProviderId
