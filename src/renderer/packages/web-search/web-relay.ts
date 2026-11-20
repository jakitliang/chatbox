import routes from '@shared/services/web-search/web-relay-routes.json'

export function getWebSearchRelayPath(url: string) {
  const target = new URL(url)
  const queries = target.searchParams.getAll('q')
  if (queries.length !== 1) return
  target.searchParams.delete('q')
  const route = Object.entries(routes).find(([, upstream]) => new URL(upstream).href === target.href)
  if (route) return `/web-search-relay/${route[0]}?${new URLSearchParams({ q: queries[0] })}`
}
