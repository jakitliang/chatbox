import { fastFlowLMProvider } from '@shared/providers/definitions/fastflowlm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/utils/request'
import { resolveCompactionBudget } from './compaction-detector'
import { getConfiguredContextWindow, resolveConfiguredContextWindow } from './context-pressure'
import { getRuntimeContextWindow, refreshRuntimeContextWindow } from './runtime-context-window'

vi.mock('@/utils/request', () => ({ apiRequest: { get: vi.fn() } }))

const providerId = fastFlowLMProvider.id
const modelId = 'fixture-flm-chat'
let index = 0
const settings = () => ({
  providers: {
    [providerId]: {
      apiHost: `https://flm.example/installation-${index++}/v1/chat/completions/`,
      useProxy: true,
      models: [{ modelId, contextWindow: 131072 }],
    },
  },
})
const respond = (payload: unknown) => Promise.resolve(new Response(JSON.stringify(payload)))

describe('FastFlowLM runtime compaction window', () => {
  beforeEach(() => {
    vi.mocked(apiRequest.get).mockReset()
  })

  it('uses the loaded window rather than saved capacity and preserves reverse-proxy prefixes', async () => {
    const config = settings()
    vi.mocked(apiRequest.get).mockImplementation(() => respond({ models: [{ name: modelId, context_length: 32768 }] }))

    const window = await resolveConfiguredContextWindow(config, providerId, modelId)
    expect(window).toBe(32768)
    expect(getConfiguredContextWindow(config, providerId, modelId)).toBe(32768)
    expect(resolveCompactionBudget(modelId, undefined, window)?.contextWindow).toBe(32768)
    expect(config.providers[providerId].models[0].contextWindow).toBe(131072)
    expect(apiRequest.get).toHaveBeenCalledExactlyOnceWith(
      `${config.providers[providerId].apiHost.replace('/v1/chat/completions/', '')}/api/ps`,
      {},
      { useProxy: true, retry: 0, signal: expect.any(AbortSignal) }
    )
  })

  it.each(['', '   '])('does not probe a default endpoint when the host is empty (%j)', async (apiHost) => {
    const config = { providers: { [providerId]: { apiHost } } }
    expect(await resolveConfiguredContextWindow(config, providerId, modelId)).toBeNull()
    expect(apiRequest.get).not.toHaveBeenCalled()
  })

  it.each([
    [' http://flm.example:52625/ ', 'http://flm.example:52625/api/ps'],
    ['http://flm.example:52625/v1/', 'http://flm.example:52625/api/ps'],
    ['https://flm.example/proxy/v1/chat/completions', 'https://flm.example/proxy/api/ps'],
  ])('normalizes the configured chat endpoint (%s)', async (apiHost, url) => {
    vi.mocked(apiRequest.get).mockImplementation(() => respond({ models: [] }))
    await resolveConfiguredContextWindow({ providers: { [providerId]: { apiHost } } }, providerId, modelId)
    expect(apiRequest.get).toHaveBeenCalledExactlyOnceWith(url, {}, expect.objectContaining({ retry: 0 }))
  })

  it('refreshes changed loaded windows and forgets unloaded models', async () => {
    const config = settings()
    for (const context_length of [32768, 8192]) {
      vi.mocked(apiRequest.get).mockImplementation(() => respond({ models: [{ model: modelId, context_length }] }))
      expect(await resolveConfiguredContextWindow(config, providerId, modelId)).toBe(context_length)
    }
    vi.mocked(apiRequest.get).mockImplementation(() => respond({ models: [] }))
    const window = await resolveConfiguredContextWindow(config, providerId, modelId)
    expect(window).toBeNull()
    expect(resolveCompactionBudget(modelId, undefined, window)).toBeNull()
  })

  it.each([undefined, null, 0, -1, 0.5, '32768', Number.MAX_SAFE_INTEGER + 1])(
    'does not substitute catalog or unrelated model capacities for invalid runtime size %j',
    async (context_length) => {
      const config = settings()
      vi.mocked(apiRequest.get).mockImplementation(() =>
        respond({
          models: [
            null,
            { name: modelId, context_length, configured_context_length: 65536, model_context_length: 131072 },
            { name: `${modelId}:other`, context_length: 65536 },
          ],
        })
      )
      expect(await resolveConfiguredContextWindow(config, providerId, modelId)).toBeNull()
    }
  )

  it('uses the smaller actual window when multiple loaded entries match', async () => {
    const config = settings()
    vi.mocked(apiRequest.get).mockImplementation(() =>
      respond({
        models: [{ name: modelId, context_length: 32768 }, { model: modelId, context_length: 8192 }],
      })
    )
    expect(await resolveConfiguredContextWindow(config, providerId, modelId)).toBe(8192)
  })

  it.each([
    () => Promise.reject(new Error('offline')),
    () => Promise.resolve(new Response('{}', { status: 503 })),
    () => Promise.resolve(new Response('invalid json')),
    () => respond({ models: {} }),
  ])('clears stale runtime facts after failed or malformed responses (%#)', async (failure) => {
    const config = settings()
    vi.mocked(apiRequest.get).mockImplementation(() => respond({ models: [{ name: modelId, context_length: 32768 }] }))
    expect(await resolveConfiguredContextWindow(config, providerId, modelId)).toBe(32768)
    vi.mocked(apiRequest.get).mockImplementation(failure)
    expect(await resolveConfiguredContextWindow(config, providerId, modelId)).toBeNull()
  })

  it('isolates cached facts by host, proxy settings and model', async () => {
    const config = settings()
    const providerSettings = config.providers[providerId]
    vi.mocked(apiRequest.get).mockImplementation(() => respond({ models: [{ name: modelId, context_length: 32768 }] }))
    await resolveConfiguredContextWindow(config, providerId, modelId)
    expect(getRuntimeContextWindow(providerId, modelId, settings().providers[providerId])).toBeUndefined()
    expect(getRuntimeContextWindow(providerId, modelId, { ...providerSettings, useProxy: false })).toBeUndefined()
    expect(getRuntimeContextWindow(providerId, 'fixture-flm-other', providerSettings)).toBeUndefined()
    expect(getRuntimeContextWindow('custom-flm', modelId, providerSettings)).toBeUndefined()
  })

  it('shares in-flight probes for the same source', async () => {
    const config = settings()
    let complete: (response: Response) => void = () => {
      throw new Error('Probe did not start')
    }
    vi.mocked(apiRequest.get).mockImplementation(() =>
      new Promise<Response>((resolve) => {
        complete = resolve
      })
    )
    const first = refreshRuntimeContextWindow(providerId, modelId, config.providers[providerId])
    const second = refreshRuntimeContextWindow(providerId, modelId, config.providers[providerId])
    expect(apiRequest.get).toHaveBeenCalledOnce()
    complete(new Response(JSON.stringify({ models: [{ name: modelId, context_length: 32768 }] })))
    await Promise.all([first, second])
    expect(getConfiguredContextWindow(config, providerId, modelId)).toBe(32768)
  })

  it('bounds unresponsive probes, aborts transport and allows the next refresh', async () => {
    vi.useFakeTimers()
    try {
      const config = settings()
      vi.mocked(apiRequest.get).mockImplementation(() => new Promise(() => {}))
      const refresh = resolveConfiguredContextWindow(config, providerId, modelId)
      await vi.advanceTimersByTimeAsync(3001)
      expect(await refresh).toBeNull()
      expect(vi.mocked(apiRequest.get).mock.calls[0][2]?.signal?.aborted).toBe(true)
      vi.mocked(apiRequest.get).mockImplementation(() => respond({ models: [{ name: modelId, context_length: 8192 }] }))
      expect(await resolveConfiguredContextWindow(config, providerId, modelId)).toBe(8192)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps non-opted-in providers on their existing configured window without runtime requests', async () => {
    const config = { providers: { 'fixture-online': { models: [{ modelId, contextWindow: 65536 }] } } }
    expect(await resolveConfiguredContextWindow(config, 'fixture-online', modelId)).toBe(65536)
    expect(apiRequest.get).not.toHaveBeenCalled()
  })
})