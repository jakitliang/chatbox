import { AbortController as ReactNativeAbortController } from 'abort-controller'
import { configureAppApiServer, DEFAULT_APP_API_SERVER } from '@shared/request/chatbox-api-origin'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestAdapter } from '../../types/adapters'
import { createImageGenerationAsyncClient } from './async-client'

describe('ChatboxAI image protocol', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    configureAppApiServer(() => DEFAULT_APP_API_SERVER)
  })

  it('submits references with request-layer retry policy and polls the original task with cancellation', async () => {
    const response = {
      items: [{ uuid: 'image-1', status: 'pending', created_at: '2026-09-08' }],
      task_id: 'task-1',
      is_finished: false,
    }
    const fetchWithOptions = vi.fn(async () => new Response(JSON.stringify(response)))
    const client = createImageGenerationAsyncClient({
      request: { fetchWithOptions },
      getLicenseKey: () => 'test-license',
      getHeaders: () => ({ 'CHATBOX-PLATFORM': 'ios' }),
    })
    const request = {
      model: 'test-image',
      prompt: 'test',
      response_format: 'b64_json' as const,
      images: [{ image_url: 'data:image/png;base64,test' }],
    }
    await expect(client.submit(request)).resolves.toEqual(response)
    expect(fetchWithOptions).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:4567/api/images/async_generations',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-license',
          'Content-Type': 'application/json',
          'CHATBOX-PLATFORM': 'ios',
        },
        body: JSON.stringify(request),
      },
      { parseChatboxRemoteError: true, retry: 2 }
    )
    const controller = new AbortController()
    await client.poll('task-1', controller.signal)
    expect(fetchWithOptions).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:4567/api/images/async_generations/task-1',
      expect.objectContaining({ method: 'GET', signal: controller.signal }),
      { parseChatboxRemoteError: true, retry: 2 }
    )
  })

  it.each([undefined, '', '  '])('uses the configured app origin for an absent/blank override %j', async (apiOrigin) => {
    configureAppApiServer(() => 'http://localhost:7890')
    const response = { items: [], task_id: 'task', is_finished: true }
    const fetchWithOptions = vi.fn(async () => new Response(JSON.stringify(response)))
    const client = createImageGenerationAsyncClient({
      request: { fetchWithOptions }, getLicenseKey: () => 'test', apiOrigin,
    })
    await client.submit({ model: 'test-image', prompt: 'test', response_format: 'b64_json' })
    await client.poll('task/id')
    expect(fetchWithOptions).toHaveBeenNthCalledWith(1, 'http://localhost:7890/api/images/async_generations', expect.anything(), expect.anything())
    expect(fetchWithOptions).toHaveBeenNthCalledWith(2, 'http://localhost:7890/api/images/async_generations/task%2Fid', expect.anything(), expect.anything())
  })

  it('preserves an explicit origin without reading the configured app origin', async () => {
    configureAppApiServer(() => { throw new Error('Must not read fallback') })
    const fetchWithOptions = vi.fn(async () => new Response(JSON.stringify({ items: [], task_id: 'task', is_finished: true })))
    const client = createImageGenerationAsyncClient({
      request: { fetchWithOptions }, getLicenseKey: () => 'test', apiOrigin: ' http://localhost:9876/// ',
    })
    await client.poll('task')
    expect(fetchWithOptions).toHaveBeenCalledWith('http://localhost:9876/api/images/async_generations/task', expect.anything(), expect.anything())
  })

  it('fails on invalid configured origin before reading credentials or requesting', () => {
    configureAppApiServer(() => 'not-an-origin')
    const fetchWithOptions = vi.fn()
    const getLicenseKey = vi.fn(() => 'secret')
    expect(() => createImageGenerationAsyncClient({ request: { fetchWithOptions }, getLicenseKey })).toThrow()
    expect(getLicenseKey).not.toHaveBeenCalled()
    expect(fetchWithOptions).not.toHaveBeenCalled()
  })

  it('rejects malformed task responses before they can enter persistent history', async () => {
    const client = createImageGenerationAsyncClient({
      request: { fetchWithOptions: async () => new Response(JSON.stringify({ items: [], is_finished: false })) },
      getLicenseKey: () => 'test',
    })
    await expect(client.poll('task')).rejects.toThrow()
  })

  it('forwards the same native signal and propagates request cancellation', async () => {
    vi.stubGlobal('AbortController', ReactNativeAbortController)
    const controller = new AbortController()
    const cancellation = new Error('FetchRequestCanceledException')
    let markRequested = () => {}
    const requested = new Promise<void>((resolve) => {
      markRequested = resolve
    })
    const fetchWithOptions = vi.fn<RequestAdapter['fetchWithOptions']>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          markRequested()
          expect(init?.signal).toBe(controller.signal)
          init?.signal?.addEventListener('abort', () => reject(cancellation), { once: true })
        })
    )
    const client = createImageGenerationAsyncClient({
      request: { fetchWithOptions },
      getLicenseKey: () => 'test-license',
    })

    const polling = client.poll('original-task', controller.signal)
    const rejected = expect(polling).rejects.toBe(cancellation)
    await requested
    controller.abort()
    await rejected

    expect(controller.signal.aborted).toBe(true)
    expect(fetchWithOptions).toHaveBeenCalledTimes(1)
  })
})
