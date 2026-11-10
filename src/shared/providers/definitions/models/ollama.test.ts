import { describe, expect, it, vi } from 'vitest'
import type { Config, ProviderModelInfo, Settings } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { getModel } from '../../index'
import Ollama from './ollama'

function dependencies(apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>()): ModelDependencies {
  return {
    request: { apiRequest, fetchWithOptions: vi.fn() },
    storage: { saveImage: vi.fn(), getImage: vi.fn() },
    sentry: { captureException: vi.fn(), withScope: vi.fn() },
    getRemoteConfig: vi.fn(),
    platformType: 'desktop',
  }
}

const response = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status }))

describe('Ollama native model discovery', () => {
  it.each([
    [' http://127.0.0.1:11434/ ', 'http://127.0.0.1:11434'],
    ['http://127.0.0.1:11434/v1', 'http://127.0.0.1:11434'],
    ['https://proxy.example/ollama/v1/chat/completions/', 'https://proxy.example/ollama'],
  ])('discovers capabilities using the normalized host %s', async (ollamaHost, host) => {
    const nativeCapabilities: Record<string, string[]> = {
      'gpt-oss:20b': ['completion', 'tools', 'thinking'],
      'my-vision-alias:latest': ['completion', 'tools', 'vision'],
      'qwen3:plain': ['completion'],
      'nomic-embed-text:latest': ['embedding'],
    }
    const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockImplementation((options) => {
      if (options.method === 'GET') {
        return response({ models: Object.keys(nativeCapabilities).map((name) => ({ name })) })
      }
      const { model } = JSON.parse(options.body as string)
      return response({ capabilities: nativeCapabilities[model] })
    })
    const model = new Ollama({ ollamaHost, model: { modelId: '' }, useProxy: true }, dependencies(apiRequest))

    const models = await model.listModels()

    expect(models).toEqual([
      { modelId: 'gpt-oss:20b', type: 'chat', capabilities: ['tool_use', 'reasoning'] },
      { modelId: 'my-vision-alias:latest', type: 'chat', capabilities: ['tool_use', 'vision'] },
      { modelId: 'qwen3:plain', type: 'chat', capabilities: [] },
      { modelId: 'nomic-embed-text:latest', type: 'embedding', capabilities: [] },
    ])
    expect(apiRequest).toHaveBeenNthCalledWith(1, {
      url: `${host}/api/tags`,
      method: 'GET',
      useProxy: true,
    })
    for (const name of Object.keys(nativeCapabilities)) {
      expect(apiRequest).toHaveBeenCalledWith({
        url: `${host}/api/show`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name }),
        useProxy: true,
      })
    }
    expect(apiRequest).toHaveBeenCalledTimes(5)

    // The same persisted metadata drives getModel(), which is used by the
    // composer capability hook and by generation's runtime gate.
    for (const discovered of models) {
      const runtime = getModel(
        { provider: 'ollama', modelId: discovered.modelId },
        { providers: { ollama: { apiHost: host, models } } } as Settings,
        { uuid: '' } as Config,
        dependencies()
      )
      expect(runtime.isSupportToolUse('agent')).toBe(discovered.capabilities?.includes('tool_use'))
      expect(runtime.isSupportToolUse('read-file')).toBe(discovered.capabilities?.includes('tool_use'))
      expect(runtime.isSupportVision()).toBe(discovered.capabilities?.includes('vision'))
      expect(runtime.isSupportReasoning()).toBe(discovered.capabilities?.includes('reasoning'))
    }
  })

  it('keeps other models when individual show requests fail or lack capabilities', async () => {
    const names = ['gpt-oss:20b', 'network-error', 'http-error', 'old-server', 'empty', 'invalid-json']
    const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockImplementation((options) => {
      if (options.method === 'GET') return response({ models: names.map((name) => ({ name })) })
      const { model } = JSON.parse(options.body as string)
      if (model === 'network-error') return Promise.reject(new Error('offline'))
      if (model === 'http-error') return response({ error: 'unavailable' }, 404)
      if (model === 'old-server') return response({})
      if (model === 'invalid-json') return Promise.resolve(new Response('not json'))
      return response({ capabilities: model === 'empty' ? [] : ['completion', 'tools'] })
    })
    const model = new Ollama({ ollamaHost: 'http://localhost:11434', model: { modelId: '' } }, dependencies(apiRequest))
    expect(await model.listModels()).toEqual(
      names.map((modelId) => ({
        modelId,
        type: 'chat',
        ...(modelId === 'gpt-oss:20b' ? { capabilities: ['tool_use'] } : {}),
        ...(modelId === 'empty' ? { capabilities: [] } : {}),
      }))
    )
  })

  it('uses tags metadata as fallback, but gives explicit show capabilities precedence', async () => {
    const names = ['failed-show', 'missing-capabilities', 'empty-capabilities', 'embedding']
    const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockImplementation((options) => {
      if (options.method === 'GET') {
        return response({
          models: names.map((name) => ({ name, capabilities: ['completion', 'tools', 'thinking'] })),
        })
      }
      const { model } = JSON.parse(options.body as string)
      if (model === 'failed-show') return Promise.reject(new Error('offline'))
      if (model === 'missing-capabilities') return response({})
      return response({ capabilities: model === 'embedding' ? ['embedding'] : [] })
    })
    const model = new Ollama({ ollamaHost: 'http://localhost:11434', model: { modelId: '' } }, dependencies(apiRequest))

    expect(await model.listModels()).toEqual([
      { modelId: 'failed-show', type: 'chat', capabilities: ['tool_use', 'reasoning'] },
      { modelId: 'missing-capabilities', type: 'chat', capabilities: ['tool_use', 'reasoning'] },
      { modelId: 'empty-capabilities', type: 'chat', capabilities: [] },
      { modelId: 'embedding', type: 'embedding', capabilities: [] },
    ])
  })

  it.each(['offline', 'http-error', 'invalid-payload'])('handles a failed tags request: %s', async (failure) => {
    const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockImplementation(() => {
      if (failure === 'offline') return Promise.reject(new Error('offline'))
      return failure === 'http-error' ? response({ error: 'unavailable' }, 500) : response({})
    })
    const model = new Ollama({ ollamaHost: 'http://localhost:11434', model: { modelId: '' } }, dependencies(apiRequest))
    expect(await model.listModels()).toEqual([])
    expect(apiRequest).toHaveBeenCalledTimes(1)
  })

  it.each<ProviderModelInfo>([
    { modelId: 'qwen3:latest', capabilities: [] },
    { modelId: 'llama3.2:latest', capabilities: ['reasoning'] },
    { modelId: 'qwen3:unknown' },
  ])('does not infer tools or vision from the name $modelId', (info) => {
    const model = new Ollama({ ollamaHost: 'http://localhost:11434', model: info }, dependencies())
    expect(model.isSupportToolUse('agent')).toBe(false)
    expect(model.isSupportVision()).toBe(false)
  })
})
