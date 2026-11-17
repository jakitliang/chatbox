import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@shared/providers/definitions/ollama'
import { apiRequest } from '@/utils/request'
import { resolveCompactionBudget } from './compaction-detector'
import { getConfiguredContextWindow, resolveConfiguredContextWindow } from './context-pressure'
import { getRuntimeContextWindow, refreshRuntimeContextWindow } from './runtime-context-window'

const getOllamaRuntimeContextWindow = (config: ReturnType<typeof settings>, modelId: string) =>
  getRuntimeContextWindow('ollama', modelId === 'local' ? 'local:latest' : modelId, config.providers.ollama)
const refreshOllamaRuntimeContext = (config: ReturnType<typeof settings>) =>
  refreshRuntimeContextWindow('ollama', 'local:latest', config.providers.ollama)

vi.mock('@/utils/request', () => ({ apiRequest: { get: vi.fn() } }))

let index = 0
const settings = () => ({
  providers: {
    ollama: {
      apiHost: `https://proxy.example/ollama-${index++}/v1/chat/completions/`,
      useProxy: true,
      models: [{ modelId: 'local:latest', contextWindow: 131072 }],
    },
  },
})
const respond = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data)))

describe('Ollama loaded context window', () => {
  it('bounds unresponsive native transports and permits subsequent refreshes', async () => {
    vi.useFakeTimers()
    try {
      const config = settings()
      vi.mocked(apiRequest.get).mockImplementation(() => new Promise(() => {}))
      const refresh = refreshOllamaRuntimeContext(config)
      await vi.advanceTimersByTimeAsync(3001)
      await refresh
      expect(getConfiguredContextWindow(config, 'ollama', 'local:latest')).toBeNull()
      vi.mocked(apiRequest.get).mockImplementation(() =>
        respond({ models: [{ name: 'local', context_length: 16384 }] })
      )
      await refreshOllamaRuntimeContext(config)
      expect(getConfiguredContextWindow(config, 'ollama', 'local:latest')).toBe(16384)
    } finally {
      vi.useRealTimers()
    }
  })

  beforeEach(() => {
    vi.mocked(apiRequest.get).mockReset()
  })

  it('uses ps actual window ahead of the saved theoretical window and retains proxy prefixes', async () => {
    const config = settings()
    vi.mocked(apiRequest.get).mockImplementation(() =>
      respond({ models: [{ name: 'local:latest', context_length: 8192 }] })
    )
    expect(await resolveConfiguredContextWindow(config, 'ollama', 'local:latest')).toBe(8192)
    expect(getConfiguredContextWindow(config, 'ollama', 'local:latest')).toBe(8192)
    expect(getOllamaRuntimeContextWindow(config, 'local')).toBe(8192)
    expect(apiRequest.get).toHaveBeenCalledWith(
      `${config.providers.ollama.apiHost.replace('/v1/chat/completions/', '')}/api/ps`,
      {},
      expect.objectContaining({ useProxy: true, retry: 0, signal: expect.any(AbortSignal) })
    )
    expect(config.providers.ollama.models[0].contextWindow).toBe(131072)
  })

  it('refreshes changed loaded sizes and clears unloaded models instead of reusing stale facts', async () => {
    const config = settings()
    for (const length of [32768, 4096]) {
      vi.mocked(apiRequest.get).mockImplementation(() =>
        respond({ models: [{ model: 'local:latest', context_length: length }] })
      )
      expect(await resolveConfiguredContextWindow(config, 'ollama', 'local:latest')).toBe(length)
    }
    vi.mocked(apiRequest.get).mockImplementation(() => respond({ models: [] }))
    await refreshOllamaRuntimeContext(config)
    expect(getOllamaRuntimeContextWindow(config, 'local:latest')).toBeUndefined()
  })

  it.each([0, -1, 1.5, '8192', undefined])('ignores invalid sizes %s and unrelated tags', async (length) => {
    const config = settings()
    vi.mocked(apiRequest.get).mockImplementation(() =>
      respond({
        models: [
          { name: 'local:latest', context_length: length },
          { name: 'local:other', context_length: 16384 },
        ],
      })
    )
    await refreshOllamaRuntimeContext(config)
    expect(getOllamaRuntimeContextWindow(config, 'local')).toBeUndefined()
    await refreshRuntimeContextWindow('ollama', 'local:other', config.providers.ollama)
    expect(getOllamaRuntimeContextWindow(config, 'local:other')).toBe(16384)
  })

  it('isolates hosts and clears stale sizes after request failures', async () => {
    const first = settings()
    const second = settings()
    vi.mocked(apiRequest.get).mockImplementation(() => respond({ models: [{ name: 'local', context_length: 8192 }] }))
    await refreshOllamaRuntimeContext(first)
    expect(getOllamaRuntimeContextWindow(second, 'local')).toBeUndefined()
    vi.mocked(apiRequest.get).mockRejectedValue(new Error('offline'))
    await refreshOllamaRuntimeContext(first)
    expect(getOllamaRuntimeContextWindow(first, 'local')).toBeUndefined()
    expect(await resolveConfiguredContextWindow({}, 'ollama', 'unknown')).toBeNull()
  })

  it.each([
    ['openai', 'gpt', 272000],
    ['gemini', 'gemini-large', 1048576],
    ['claude', 'claude-large', 200000],
    ['custom-online', 'custom-large', 512000],
  ])('preserves %s context without probing runtime APIs', async (providerId, modelId, window) => {
    expect(
      await resolveConfiguredContextWindow(
        { providers: { [providerId]: { models: [{ modelId, contextWindow: window }] } } },
        providerId,
        modelId
      )
    ).toBe(window)
    expect(await resolveConfiguredContextWindow({}, providerId, modelId)).toBeUndefined()
    expect(apiRequest.get).not.toHaveBeenCalled()
  })

  it('does not invent a compaction budget for an unavailable runtime delegate', async () => {
    vi.mocked(apiRequest.get).mockRejectedValue(new Error('offline'))
    const window = await resolveConfiguredContextWindow(settings(), 'ollama', 'local:latest')
    expect(window).toBeNull()
    expect(resolveCompactionBudget('local:latest', undefined, window)).toBeNull()
  })
})
