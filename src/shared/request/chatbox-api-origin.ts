/** Optional manual SQLite sync backend, never an AI or metadata API. */
export const DEFAULT_APP_API_SERVER = ''
let readServer: () => unknown = () => DEFAULT_APP_API_SERVER

export function normalizeAppApiServer(value: string): string {
  const input = value.trim()
  if (!input) return ''
  // Accept IP:port shorthand; remote addresses still require TLS.
  const shorthand = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[\da-fA-F:]+\]|localhost):\d+\/?$/.test(input)
  const url = new URL(shorthand ? `http://${input}` : input)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Application API Server must be an HTTP(S) origin without paths or credentials')
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' ||
    /^127\.\d+\.\d+\.\d+$/.test(url.hostname)
  if (url.protocol === 'http:' && !loopback) {
    if (shorthand) url.protocol = 'https:'
    else throw new Error('Application API Server requires HTTPS outside loopback')
  }
  return url.origin
}

export function configureAppApiServer(reader: () => unknown): void {
  readServer = reader
}

export function getChatboxAPIOrigin(_legacyEnvironment?: Readonly<Record<string, string | undefined>>): string {
  const value = readServer()
  // No vendor fallback or cached server list. Invalid saved configuration fails visibly.
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error('Application API Server must be a string')
  return normalizeAppApiServer(value)
}

/** Old server responses cannot change the explicitly configured application backend. */
export function setDynamicChatboxAPIOrigin(_origin: string): void {}
