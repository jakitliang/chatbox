import type { ProviderModelInfo, RemoteConfig, Settings } from '../types'

/** Virtual origin: handled in-process, never resolved or opened as a socket. */
export const LOCAL_SERVICE_ORIGIN = 'http://chatbox.localhost'
const FORBIDDEN_DOMAINS = [
  'chatboxai.app', 'chatboxai.com', 'ai-chatbox.com', 'chatboxapp.xyz',
  'midway.run', 'google-analytics.com', 'googletagmanager.com',
  'sentry.io', 'sentry-cdn.com', 'plausible.io', 'vibedrop.com', 'lemonsqueezy.com',
]
type RuntimeSettings = Pick<Settings, 'localRuntime' | 'providers' | 'defaultEmbeddingModel' | 'defaultRerankModel'>
let readSettings: () => Partial<RuntimeSettings> = () => ({})

/** Defaults remain fail-closed until the host has hydrated its local settings. */
export function configureLocalRuntime(reader: () => Partial<RuntimeSettings>): void {
  readSettings = reader
}

export function isForbiddenHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return FORBIDDEN_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === 'localhost' || host === '[::1]' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

function parseUrl(input: string | URL): URL | undefined {
  try {
    return new URL(input, typeof location === 'undefined' ? undefined : location.href)
  } catch {
    return undefined
  }
}

/** Application API servers are origins, not model URLs or /api paths. */
export function normalizeAppApiServer(input: string): string {
  const url = new URL(input.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash || isForbiddenHost(url.hostname) ||
    url.origin === LOCAL_SERVICE_ORIGIN) {
    throw new Error('Use an HTTP(S) application API server origin, without paths, credentials or vendor/telemetry domains.')
  }
  return url.origin
}

/** Invalid persisted configuration fails closed rather than restoring a vendor server. */
export function getApplicationApiOrigin(): string {
  const configured = readSettings().localRuntime?.appApiServer
  if (typeof configured !== 'string' || !configured.trim()) return LOCAL_SERVICE_ORIGIN
  try {
    return normalizeAppApiServer(configured)
  } catch {
    return LOCAL_SERVICE_ORIGIN
  }
}

/** Exact origins only. No wildcards, suffix matching, credentials or vendor overrides. */
export function isNetworkUrlAllowed(input: string | URL): boolean {
  const url = parseUrl(input)
  if (!url) return false
  if (['data:', 'blob:', 'file:', 'about:'].includes(url.protocol)) return true
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return false
  if (url.username || url.password || isForbiddenHost(url.hostname)) return false
  if (url.origin === LOCAL_SERVICE_ORIGIN) return false // Only the in-process responder may handle this.
  if (isLoopbackHost(url.hostname)) return true
  const origin = url.origin.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
  // Explicitly selecting the application server authorizes only that exact origin.
  if (origin === getApplicationApiOrigin()) return true
  const entries = readSettings().localRuntime?.allowedOrigins
  if (!Array.isArray(entries)) return false
  return entries.some((entry) => {
    if (typeof entry !== 'string') return false
    const allowed = parseUrl(entry)
    return allowed && !allowed.username && !allowed.password && allowed.origin === origin
  })
}

export class LocalNetworkBlockedError extends Error {
  constructor(input: string | URL) {
    // Never log query strings, credentials, request bodies or bearer tokens.
    super(`Local privacy policy blocked network access to ${parseUrl(input)?.origin ?? 'invalid URL'}`)
    this.name = 'LocalNetworkBlockedError'
  }
}

export function assertNetworkUrlAllowed(input: string | URL): void {
  if (!isNetworkUrlAllowed(input)) throw new LocalNetworkBlockedError(input)
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** Compatibility responses for read-only catalogs. Never simulate paid entitlements or cloud success. */
export async function respondToLocalService(request: Request): Promise<Response> {
  if (request.signal.aborted) throw request.signal.reason ?? new DOMException('Aborted', 'AbortError')
  const url = new URL(request.url)
  if (url.origin !== LOCAL_SERVICE_ORIGIN) throw new LocalNetworkBlockedError(url)
  const path = url.pathname
  const settings = readSettings()
  if (path.startsWith('/api/remote_config/')) {
    const config: RemoteConfig = {
      current_version: '', product_ids: [],
      ...settings.localRuntime?.remoteConfig,
      setting_chatboxai_first: false,
    }
    return jsonResponse({ data: config })
  }
  if (path === '/api/session_rag/config') {
    const embedding = settings.defaultEmbeddingModel
    const rerank = settings.defaultRerankModel
    return jsonResponse({ data: {
      models: {
        embedding: embedding ? `${embedding.provider}:${embedding.model}` : '',
        rerank: rerank ? `${rerank.provider}:${rerank.model}` : '',
      },
      capabilities: { session_attachment_embedding: Boolean(embedding), session_attachment_rerank: Boolean(rerank) },
    } })
  }
  if (path.startsWith('/chatbox_need_update/')) return jsonResponse({ need_update: false })
  if (path === '/api/api_origins') return jsonResponse({ data: { api_origins: [] } })
  if (path.startsWith('/api/system_copilots/tags/')) return jsonResponse({ data: [] })
  if (path === '/api/system_copilots/list') return jsonResponse({ data: [], next_cursor: null })
  if (path === '/api/client_notifications/next' || path === '/api/dialog_config') return jsonResponse({ data: null })
  if (path.startsWith('/api/license/detail')) return jsonResponse({ data: null })
  if (path === '/api/license/validate') return jsonResponse({ valid: false })
  if (path === '/api/license/deactivate') return jsonResponse({ success: true })
  if (path === '/api/model_manifest') {
    const body = await readJsonBody(request)
    const provider = typeof body.aiProvider === 'string' ? body.aiProvider : ''
    const models = provider === 'chatbox-ai' ? [] : settings.providers?.[provider]?.models ?? []
    const convert = (model: ProviderModelInfo) => ({ ...model, modelName: model.nickname || model.modelId })
    return jsonResponse({ success: true, data: {
      groupName: provider,
      models: models.filter((model) => model.type !== 'image').map(convert),
      imageModels: models.filter((model) => model.type === 'image').map(convert),
    } })
  }
  if (path === '/api/provider_models_info') return jsonResponse({ success: true, data: {} })
  if (path === '/api/chatbox_ai/model_list') return jsonResponse({ success: true, data: {
    provider: { id: 'chatbox-ai', name: 'Chatbox AI' }, license: { plan: 'unavailable' }, groups: [], models: {}, imageModels: [],
  } })
  // Drop usage/share/report events without serializing their sensitive bodies.
  if (['/api/system_copilots/record_usage', '/api/copilots/share-record', '/api/report'].includes(path)) {
    return jsonResponse({ success: true })
  }
  return jsonResponse({ error: {
    code: 'local_service_unavailable', title: 'Cloud service disabled',
    detail: 'Use a locally configured provider or parser. No request was sent.', status: 403,
  } }, 403)
}

export function createPrivateFetch(transport: typeof fetch): typeof fetch {
  return async (input, init) => {
    const target = input instanceof Request ? input.url : input.toString()
    const url = parseUrl(target)
    if (url?.origin === LOCAL_SERVICE_ORIGIN) return respondToLocalService(new Request(input, init))
    assertNetworkUrlAllowed(target)
    // Browser redirects are opaque: fail closed rather than follow an unchecked target.
    let request = input instanceof Request ? new Request(input, init) : new Request(url?.href ?? target, init)
    const redirectMode = request.redirect
    for (let hop = 0; hop < 20; hop++) {
      assertNetworkUrlAllowed(request.url)
      const response = await transport(request.clone(), { redirect: 'manual' })
      if (response.type === 'opaqueredirect') throw new LocalNetworkBlockedError(request.url)
      if (![301, 302, 303, 307, 308].includes(response.status) || redirectMode === 'manual') return response
      if (redirectMode === 'error') throw new LocalNetworkBlockedError(request.url)
      const location = response.headers.get('location')
      if (!location) return response
      const next = new URL(location, request.url)
      assertNetworkUrlAllowed(next)
      const headers = new Headers(request.headers)
      if (next.origin !== new URL(request.url).origin) {
        headers.delete('authorization')
        headers.delete('cookie')
        headers.delete('proxy-authorization')
        headers.delete('x-chatbox-access-token')
      }
      const toGet = (response.status === 303 && request.method !== 'HEAD') ||
        ((response.status === 301 || response.status === 302) && request.method === 'POST')
      if (toGet) {
        headers.delete('content-type')
        headers.delete('content-length')
      }
      const body = toGet || request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()
      request = new Request(next, {
        method: toGet ? 'GET' : request.method, headers, body, signal: request.signal,
        credentials: request.credentials, mode: request.mode, cache: request.cache,
      })
    }
    throw new LocalNetworkBlockedError(request.url)
  }
}

let installed = false
export function installPrivateFetch(): void {
  if (installed || typeof globalThis.fetch !== 'function') return
  installed = true
  globalThis.fetch = createPrivateFetch(globalThis.fetch.bind(globalThis))
}