import { CapacitorHttp } from '@capacitor/core'
import type { SearchRequest } from '@shared/services/web-search/types'
import { type FetchOptions, ofetch } from 'ofetch'
import platform from '@/platform'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
import { getWebSearchRelayPath } from './web-relay'

const MOBILE_USER_AGENTS = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
}

export const rendererSearchRequest: SearchRequest = async (url, init, responseType) => {
  const method = (init?.method ?? 'GET') as FetchOptions['method']
  if (
    platform.type === 'web' &&
    import.meta.env.VITE_WEB_SEARCH_RELAY &&
    method === 'GET' &&
    !new Headers(init?.headers).has('Authorization')
  ) {
    const relayPath = getWebSearchRelayPath(url)
    if (relayPath) {
      const language = new Headers(init?.headers).get('Accept-Language')
      return fetch(relayPath, {
        headers: { 'X-Chatbox-Search': '1', ...(language && { 'Accept-Language': language }) },
        credentials: 'omit',
        redirect: 'error',
        signal: init?.signal,
      })
    }
  }
  if (platform.type !== 'mobile') {
    const response = await ofetch.raw(url, { ...init, method, responseType, ignoreResponseError: true, retry: 0 })
    return {
      ok: response.ok,
      status: response.status,
      json: async () => response._data,
      text: async () => String(response._data),
    }
  }

  const headers = new Headers(init?.headers)
  headers.set('User-Agent', MOBILE_USER_AGENTS[CHATBOX_BUILD_PLATFORM === 'ios' ? 'ios' : 'android'])
  const headerEntries: Record<string, string> = {}
  headers.forEach((value, key) => {
    headerEntries[key] = value
  })
  const body = init?.body
  const data =
    typeof body === 'string' && headers.get('Content-Type')?.includes('application/json') ? JSON.parse(body) : body
  const response = await CapacitorHttp.request({
    url,
    method: method ?? 'GET',
    headers: headerEntries,
    data,
    responseType,
  })
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.data,
    text: async () => String(response.data),
  }
}
