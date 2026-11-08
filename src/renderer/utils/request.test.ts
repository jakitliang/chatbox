import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  platform: { type: 'desktop', getVersion: vi.fn(async () => '1.0.0') },
  desktopDirectRequest: vi.fn(),
  mobileRequest: vi.fn(),
}))

vi.mock('@/platform', () => ({ default: mocks.platform }))
vi.mock('./desktop-direct-request', () => ({ desktopDirectRequestFromWindow: mocks.desktopDirectRequest }))
vi.mock('./mobile-request', () => ({ handleMobileRequest: mocks.mobileRequest }))
vi.mock('@/native/background-stream', () => ({ backgroundStreamPrototypeEnabled: false }))

import { apiRequest, fetchWithProxy } from './request'

describe('provider API request routing', () => {
  afterEach(() => {
    mocks.platform.type = 'desktop'
    mocks.platform.getVersion.mockClear()
    mocks.desktopDirectRequest.mockReset()
    mocks.mobileRequest.mockReset()
    vi.unstubAllGlobals()
  })

  it('uses the main-process direct transport for remote desktop targets when compatibility is enabled', async () => {
    const response = new Response('ok')
    mocks.desktopDirectRequest.mockResolvedValue(response)
    const rendererFetch = vi.fn()
    vi.stubGlobal('fetch', rendererFetch)

    await expect(
      apiRequest.post('https://provider.example/v1/chat', { authorization: 'Bearer secret' }, '{"stream":true}', {
        useProxy: true,
        retry: 0,
      })
    ).resolves.toBe(response)

    expect(mocks.desktopDirectRequest).toHaveBeenCalledWith(
      'https://provider.example/v1/chat',
      'POST',
      expect.any(Headers),
      '{"stream":true}',
      undefined
    )
    const headers = mocks.desktopDirectRequest.mock.calls[0][2] as Headers
    expect(headers.get('CHATBOX-TARGET-URI')).toBeNull()
    expect(rendererFetch).not.toHaveBeenCalled()
  })

  it('keeps local desktop targets in the renderer', async () => {
    const response = new Response('ok')
    const rendererFetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', rendererFetch)

    await expect(apiRequest.get('http://127.0.0.1:11434/api/tags', {}, { useProxy: true, retry: 0 })).resolves.toBe(
      response
    )

    expect(rendererFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/tags',
      expect.objectContaining({ method: 'GET' })
    )
    expect(mocks.desktopDirectRequest).not.toHaveBeenCalled()
  })

  it('preserves the ApiError contract for failed desktop direct responses', async () => {
    mocks.desktopDirectRequest.mockResolvedValue(
      new Response('upstream unavailable', { status: 503, headers: { 'Retry-After': '10' } })
    )

    const request = apiRequest.get('https://provider.example/v1/models', {}, { useProxy: true, retry: 0 })

    await expect(request).rejects.toMatchObject({
      message: 'API Error: Status Code 503',
      responseBody: 'upstream unavailable',
      statusCode: 503,
      retryAfter: '10',
    })
  })

  it('preserves AbortError without retrying a cancelled desktop direct request', async () => {
    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    mocks.desktopDirectRequest.mockRejectedValue(abortError)

    const request = apiRequest.get('https://provider.example/v1/models', {}, { useProxy: true, retry: 3 })

    await expect(request).rejects.toBe(abortError)
    expect(mocks.desktopDirectRequest).toHaveBeenCalledTimes(1)
  })

  it('sends web BYOK requests directly without vendor relay headers', async () => {
    mocks.platform.type = 'web'
    const response = new Response('ok')
    const rendererFetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', rendererFetch)

    await apiRequest.get(
      'https://provider.example/v1/models',
      { authorization: 'Bearer secret' },
      { useProxy: true, retry: 0 }
    )

    expect(rendererFetch).toHaveBeenCalledWith(
      'https://provider.example/v1/models',
      expect.objectContaining({ method: 'GET' })
    )
    const headers = rendererFetch.mock.calls[0][1].headers as Headers
    expect(headers.get('authorization')).toBe('Bearer secret')
    expect(headers.get('CHATBOX-TARGET-URI')).toBeNull()
    expect(headers.get('CHATBOX-PLATFORM')).toBeNull()
    expect(headers.get('CHATBOX-VERSION')).toBeNull()
    expect(mocks.platform.getVersion).not.toHaveBeenCalled()
    expect(mocks.desktopDirectRequest).not.toHaveBeenCalled()
  })

  it('preserves web BYOK POST credentials, body, and cancellation on the provider request', async () => {
    mocks.platform.type = 'web'
    const response = new Response('ok')
    const rendererFetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', rendererFetch)
    const controller = new AbortController()
    const body = '{"messages":[{"role":"user","content":"private prompt"}]}'

    await expect(
      apiRequest.post('https://provider.example/v1/chat', { authorization: 'Bearer secret' }, body, {
        useProxy: true,
        retry: 0,
        signal: controller.signal,
      })
    ).resolves.toBe(response)

    expect(rendererFetch).toHaveBeenCalledTimes(1)
    expect(rendererFetch).toHaveBeenCalledWith(
      'https://provider.example/v1/chat',
      expect.objectContaining({ method: 'POST', body, signal: controller.signal })
    )
    const headers = rendererFetch.mock.calls[0][1].headers as Headers
    expect(headers.get('authorization')).toBe('Bearer secret')
    expect(headers.get('CHATBOX-TARGET-URI')).toBeNull()
    expect(mocks.mobileRequest).not.toHaveBeenCalled()
    expect(mocks.desktopDirectRequest).not.toHaveBeenCalled()
  })

  it('reports web CORS failures without falling back to a hosted or native relay', async () => {
    mocks.platform.type = 'web'
    const rendererFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', rendererFetch)

    await expect(
      apiRequest.get('https://provider.example/v1/models', { authorization: 'Bearer secret' }, {
        useProxy: true,
        retry: 0,
      })
    ).rejects.toBeInstanceOf(Error)

    expect(rendererFetch).toHaveBeenCalledTimes(1)
    expect(rendererFetch.mock.calls[0][0]).toBe('https://provider.example/v1/models')
    expect(mocks.mobileRequest).not.toHaveBeenCalled()
    expect(mocks.desktopDirectRequest).not.toHaveBeenCalled()
  })

  it('does not retry failed web provider responses or cancellations', async () => {
    mocks.platform.type = 'web'
    const rendererFetch = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }))
    vi.stubGlobal('fetch', rendererFetch)

    await expect(
      apiRequest.get('https://provider.example/v1/models', {}, { useProxy: true, retry: 3 })
    ).rejects.toMatchObject({ statusCode: 429, responseBody: 'rate limited' })
    expect(rendererFetch).toHaveBeenCalledTimes(1)

    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    rendererFetch.mockReset().mockRejectedValue(abortError)
    await expect(
      apiRequest.get('https://provider.example/v1/models', {}, { useProxy: true, retry: 3 })
    ).rejects.toBe(abortError)
    expect(rendererFetch).toHaveBeenCalledTimes(1)
  })

  it('preserves the legacy fetchWithProxy entry point as a direct web request', async () => {
    mocks.platform.type = 'web'
    const response = new Response('ok')
    const rendererFetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', rendererFetch)
    const controller = new AbortController()

    await expect(
      fetchWithProxy(new URL('https://provider.example/v1/chat'), {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
        body: '{"stream":true}',
        signal: controller.signal,
      })
    ).resolves.toBe(response)

    expect(rendererFetch).toHaveBeenCalledWith(
      'https://provider.example/v1/chat',
      expect.objectContaining({ method: 'POST', body: '{"stream":true}', signal: controller.signal })
    )
  })

  it('keeps mobile BYOK requests on the native direct transport', async () => {
    mocks.platform.type = 'mobile'
    const response = new Response('ok')
    mocks.mobileRequest.mockResolvedValue(response)
    const rendererFetch = vi.fn()
    vi.stubGlobal('fetch', rendererFetch)

    await expect(
      apiRequest.get('https://provider.example/v1/models', {}, { useProxy: true, retry: 0 })
    ).resolves.toBe(response)

    expect(mocks.mobileRequest).toHaveBeenCalledWith(
      'https://provider.example/v1/models',
      'GET',
      expect.any(Headers),
      undefined,
      undefined
    )
    expect(rendererFetch).not.toHaveBeenCalled()
  })
})
