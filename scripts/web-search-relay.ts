import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import routes from '../src/shared/services/web-search/web-relay-routes.json'

const PREFIX = '/web-search-relay/'
const MAX_BYTES = 2 * 1024 * 1024

export async function relayWebSearch(req: IncomingMessage, res: ServerResponse, fetchUpstream = fetch) {
  const send = (status: number, body: string | Buffer) => {
    res.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    })
    res.end(body)
  }
  if (
    req.method !== 'GET' ||
    req.headers['x-chatbox-search'] !== '1' ||
    (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin') ||
    (req.headers.origin !== undefined && req.headers.origin !== `http://${req.headers.host}`)
  ) {
    return send(403, 'Search relay requires a same-origin GET')
  }

  const url = new URL(`http://localhost${req.url}`)
  const route = url.pathname.slice(PREFIX.length)
  const upstream = Object.entries(routes).find(([name]) => name === route)?.[1]
  if (!upstream) return send(404, 'Unknown search relay route')
  const query = url.searchParams.get('q')
  if (!query?.trim() || query.length > 1024 || url.searchParams.size !== 1) return send(400, 'Invalid search query')

  const target = new URL(upstream)
  target.searchParams.set('q', query)
  try {
    const response = await fetchUpstream(target, {
      headers: {
        Accept: 'text/html',
        'Accept-Language': req.headers['accept-language']?.slice(0, 256) || 'en-US,en;q=0.9',
        'User-Agent': req.headers['user-agent']?.slice(0, 512) || 'Chatbox Web Search',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      return send(502, `Search upstream returned ${response.status}`)
    }
    let size = 0
    const chunks: Uint8Array[] = []
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > MAX_BYTES) {
          await reader.cancel()
          return send(502, 'Search response exceeded size limit')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    return send(200, Buffer.concat(chunks))
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return send(timedOut ? 504 : 502, timedOut ? 'Search upstream timed out' : 'Search upstream request failed')
  }
}

export function webSearchRelay(): Plugin {
  return {
    name: 'chatbox-web-search-relay',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(PREFIX)) return next()
        void relayWebSearch(req, res).catch(next)
      })
    },
  }
}
