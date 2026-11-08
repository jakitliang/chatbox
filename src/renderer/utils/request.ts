import { isBackgroundStreamRequest } from '@shared/utils/background-stream'
import platform from '@/platform'
import { backgroundStreamPrototypeEnabled } from '@/native/background-stream'
import { ApiError, BaseError, NetworkError } from '../../shared/models/errors'
import { isLocalHost } from '../../shared/utils/network_utils'
import { desktopDirectRequestFromWindow } from './desktop-direct-request'
import { handleMobileRequest } from './mobile-request'

interface RequestOptions {
  method: string
  headers?: RequestInit['headers']
  body?: RequestInit['body']
  signal?: AbortSignal
  retry?: number
  useProxy?: boolean
}

async function retryRequest<T>(fn: () => Promise<T>, retry: number, url: string): Promise<T> {
  let requestError: BaseError | null = null

  for (let i = 0; i <= retry; i++) {
    try {
      return await fn()
    } catch (e) {
      // ApiError represents an upstream response and AbortError is an explicit
      // caller cancellation; neither belongs in the network retry path.
      if (e instanceof ApiError || (e instanceof Error && e.name === 'AbortError')) {
        throw e
      }
      let origin = 'unknown'
      try {
        origin = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost').origin
      } catch {}
      requestError = e instanceof BaseError ? e : new NetworkError((e as Error).message, origin)

      if (i < retry) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  }

  throw requestError || new Error('Unknown error')
}

function buildHeaders(options: RequestOptions): Headers {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  return headers
}

async function doRequest(url: string, options: RequestOptions): Promise<Response> {
  const { signal, retry = 3, useProxy = false, body, method } = options
  const headers = buildHeaders(options)
  const nativeBackgroundStream =
    platform.type === 'mobile' && backgroundStreamPrototypeEnabled && isBackgroundStreamRequest(url, body, headers)

  // Legacy useProxy selects native compatibility transports, never a hosted relay.
  // Web BYOK requests go directly to the provider and require its CORS support.
  const makeRequest = async () => {
    let res: Response
    if (platform.type === 'mobile' && (useProxy || nativeBackgroundStream)) {
      res = await handleMobileRequest(url, method, headers, body, signal)
    } else if (platform.type === 'desktop' && useProxy && !isLocalHost(url)) {
      res = await desktopDirectRequestFromWindow(url, method, headers, body, signal)
    } else {
      res = await fetch(url, { method, headers, body, signal })
    }

    if (!res.ok) {
      const err = await res.text().catch(() => null)
      throw new ApiError(
        `Status Code ${res.status}`,
        err ?? undefined,
        res.status,
        undefined,
        res.headers.get('retry-after') ?? undefined
      )
    }
    return res
  }

  return retryRequest(makeRequest, nativeBackgroundStream ? 0 : retry, url)
}

export const apiRequest = {
  async post(
    url: string,
    headers: Record<string, string>,
    body: RequestInit['body'],
    options?: Partial<RequestOptions>
  ) {
    return doRequest(url, { ...options, method: 'POST', headers, body })
  },

  async get(url: string, headers: Record<string, string>, options?: Partial<RequestOptions>) {
    return doRequest(url, { ...options, method: 'GET', headers })
  },
}

export async function fetchWithProxy(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return doRequest(input.toString(), {
    method: init?.method || 'GET',
    headers: init?.headers,
    body: init?.body,
    signal: init?.signal || undefined,
    useProxy: true,
  })
}
