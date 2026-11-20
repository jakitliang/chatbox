import { describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '@chatbox/core'
import {
  type Config,
  type ProviderModelInfo,
  ProviderModelInfoSchema,
  type ProviderOptions,
  type Settings,
} from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { getModel } from '../../index'
import { refreshProviderModelCapabilities } from '../../model-config'
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
const noAudio = { input: false, speech: false }

describe('Ollama native model discovery', () => {
  it('persists audio and speech independently along with server voice names', async () => {
    const request = vi
      .fn<ModelDependencies['request']['apiRequest']>()
      .mockImplementationOnce(() => response({ models: [{ name: 'voice' }, { name: 'audio' }] }))
      .mockImplementationOnce(() =>
        response({ capabilities: ['speech'], voices: ['default', 'female-chinese', 'default', 42] })
      )
      .mockImplementationOnce(() => response({ capabilities: ['audio'] }))
    const discovered = await new Ollama(
      { ollamaHost: 'http://localhost:11434', model: { modelId: '' } },
      dependencies(request)
    ).listModels()
    const models = refreshProviderModelCapabilities([{ modelId: 'voice' }, { modelId: 'audio' }], discovered).map(
      (model) => ProviderModelInfoSchema.parse(model)
    )
    expect(models.map((model) => model.audio)).toEqual([
      { input: false, speech: true, voices: ['default', 'female-chinese'] },
      { input: true, speech: false },
    ])
    expect(
      refreshProviderModelCapabilities(models, [
        { modelId: 'voice', capabilities: [], audio: { input: false, speech: false } },
      ])[0].audio
    ).toEqual({ input: false, speech: false })
  })

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
      { modelId: 'gpt-oss:20b', type: 'chat', capabilities: ['tool_use', 'reasoning'], audio: noAudio },
      { modelId: 'my-vision-alias:latest', type: 'chat', capabilities: ['tool_use', 'vision'], audio: noAudio },
      { modelId: 'qwen3:plain', type: 'chat', capabilities: [], audio: noAudio },
      { modelId: 'nomic-embed-text:latest', type: 'embedding', capabilities: [], audio: noAudio },
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
        { providers: { ollama: { apiHost: host, models } } } as unknown as Settings,
        { uuid: '' } as Config,
        dependencies()
      )
      expect(runtime.isSupportToolUse('agent')).toBe(discovered.capabilities?.includes('tool_use'))
      expect(runtime.isSupportToolUse('read-file')).toBe(discovered.capabilities?.includes('tool_use'))
      expect(runtime.isSupportVision()).toBe(discovered.capabilities?.includes('vision'))
      expect((runtime as Ollama).isSupportReasoning()).toBe(discovered.capabilities?.includes('reasoning'))
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
        ...(modelId === 'gpt-oss:20b' ? { capabilities: ['tool_use'], audio: noAudio } : {}),
        ...(modelId === 'empty' ? { capabilities: [], audio: noAudio } : {}),
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
      { modelId: 'failed-show', type: 'chat', capabilities: ['tool_use', 'reasoning'], audio: noAudio },
      { modelId: 'missing-capabilities', type: 'chat', capabilities: ['tool_use', 'reasoning'], audio: noAudio },
      { modelId: 'empty-capabilities', type: 'chat', capabilities: [], audio: noAudio },
      { modelId: 'embedding', type: 'embedding', capabilities: [], audio: noAudio },
    ])
  })

  it('refreshes named levels, clears them for a toggle, and hides off-only models', async () => {
    const values: Record<string, (boolean | string)[]> = {
      levels: ['balanced', 'high', 'balanced'],
      toggle: [false, true],
      unsupported: [false],
    }
    const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockImplementation((options) =>
      response(
        options.method === 'GET'
          ? { models: Object.keys(values).map((name) => ({ name })) }
          : {
              capabilities: ['completion', 'tools', 'thinking'],
              thinking: { values: values[JSON.parse(options.body as string).model] },
            }
      )
    )
    const ollamaHost = 'http://localhost:11434'
    const model = new Ollama({ ollamaHost, model: { modelId: '' } }, dependencies(apiRequest))
    const existing = Object.keys(values).map((modelId) => ({ modelId, reasoningEffortLevels: ['low'] }))
    const [named, toggle, unsupported] = refreshProviderModelCapabilities(existing, await model.listModels()).map(
      (info) => ProviderModelInfoSchema.parse(info)
    )
    expect(named.reasoningEffortLevels).toEqual(['balanced', 'high'])
    expect(toggle.reasoningEffortLevels).toEqual([])
    expect(unsupported.capabilities).toEqual(['tool_use'])
    const labels = (info: ProviderModelInfo) =>
      new Ollama({ ollamaHost, model: info }, dependencies()).getReasoningOptions().map(({ label }) => label)
    expect(labels(named)).toEqual(['default', 'off', 'effort:balanced', 'high'])
    expect(labels(toggle)).toEqual(['default', 'off', 'on'])
    expect(labels(unsupported)).toEqual([])
  })

  it.each([
    [{ 'general.architecture': 'llama', 'llama.context_length': 131072 }, 131072],
    [
      {
        'general.architecture': 'mistral3',
        'mistral3.context_length': 262144,
        'mistral3.rope.scaling.original_context_length': 16384,
      },
      262144,
    ],
    [{ 'general.architecture': 'llama', 'llama.context_length': -1 }, undefined],
    [{ 'general.architecture': 'llama', 'llama.context_length': '131072' }, undefined],
    [undefined, undefined],
  ])('reads only the published context maximum (%j)', async (model_info, maximum) => {
    const apiRequest = vi
      .fn<ModelDependencies['request']['apiRequest']>()
      .mockImplementation((options) =>
        response(
          options.method === 'GET'
            ? { models: [{ name: 'local:latest' }] }
            : { model_info, parameters: 'num_ctx 32768' }
        )
      )
    const model = new Ollama({ ollamaHost: 'http://localhost:11434', model: { modelId: '' } }, dependencies(apiRequest))
    const [discovered] = await model.listModels()
    expect(discovered.maxContextWindow).toBe(maximum)
    expect(discovered.contextWindow).toBeUndefined()
    expect(discovered.maxOutput).toBeUndefined()
    expect(apiRequest).toHaveBeenCalledTimes(2)
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
    expect(model.isSupportToolUse()).toBe(false)
    expect(model.isSupportVision()).toBe(false)
  })

  describe('Ollama reasoning requests', () => {
    it('uses the native transport only for an explicit context request on a factory model', async () => {
      const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockImplementation(({ url }) =>
        Promise.resolve(
          url.endsWith('/api/chat')
            ? new Response('{"model":"local","message":{"role":"assistant","content":"OK"},"done":true}\n', {
                headers: { 'content-type': 'application/x-ndjson' },
              })
            : new Response(
                'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
                { headers: { 'content-type': 'text/event-stream' } }
              )
        )
      )
      const runtime = getModel(
        { provider: 'ollama', modelId: 'local', maxTokens: 48 },
        {
          ...createDefaultSettings(),
          providers: {
            ollama: {
              apiHost: 'http://localhost:11434/prefix',
              models: [{ modelId: 'local', capabilities: ['reasoning'] }],
            },
          },
        },
        {} as Config,
        dependencies(apiRequest)
      )
      const prompt = [{ role: 'user' as const, content: 'Hello' }]
      const explicit = { providerId: 'ollama', modelId: 'local', tokens: 8192 }
      const providerOptions = runtime.writeReasoningOptions?.('high')
      expect(providerOptions).toBeDefined()
      for (const options of [{}, { contextWindowOverride: explicit, providerOptions }, {}]) {
        for await (const part of runtime.chatStream(prompt, options)) {
          expect(part.type).not.toBe('error')
        }
      }

      const requests = apiRequest.mock.calls.map(([request]) => request)
      expect(requests.map(({ url }) => url)).toEqual([
        'http://localhost:11434/prefix/v1/chat/completions',
        'http://localhost:11434/prefix/api/chat',
        'http://localhost:11434/prefix/v1/chat/completions',
      ])
      expect(JSON.parse(String(requests[0].body))).not.toHaveProperty('num_ctx')
      expect(JSON.parse(String(requests[1].body)).options).toMatchObject({ num_ctx: 8192, num_predict: 48 })
      expect(JSON.parse(String(requests[1].body))).toHaveProperty('think', true)
      expect(JSON.parse(String(requests[2].body))).not.toHaveProperty('num_ctx')
    })

    it.each([
      [undefined, 'default', undefined],
      [undefined, 'off', 'none'],
      [[], 'high', 'high'],
      [['low', 'high'], 'low', 'low'],
      [['balanced'], 'effort:balanced', 'balanced'],
    ] as const)(
      'sends the selected effort for %j / %s on the compatibility endpoint',
      async (levels, level, effort) => {
        const apiRequest = vi
          .fn<ModelDependencies['request']['apiRequest']>()
          .mockResolvedValue(
            new Response(
              'data: {"choices":[{"index":0,"delta":{"reasoning":"trace"},"finish_reason":null}]}\n\n' +
                'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
              { headers: { 'content-type': 'text/event-stream' } }
            )
          )
        const runtime = new Ollama(
          {
            ollamaHost: 'http://localhost:11434',
            model: {
              modelId: 'local',
              capabilities: ['reasoning'],
              reasoningEffortLevels: levels ? [...levels] : undefined,
            },
          },
          dependencies(apiRequest)
        )
        const providerOptions = runtime.writeReasoningOptions(level)
        expect(runtime.readReasoningLevel(providerOptions)).toBe(level)
        const parts = []
        for await (const part of runtime.chatStream([{ role: 'user', content: 'Hello' }], { providerOptions })) {
          parts.push(part)
        }
        expect(parts.some(({ type }) => type === 'reasoning-delta')).toBe(true)
        expect(apiRequest).toHaveBeenCalledOnce()
        const [request] = apiRequest.mock.calls[0]
        expect(request.url).toBe('http://localhost:11434/v1/chat/completions')
        const body = JSON.parse(request.body as string)
        expect(body).not.toHaveProperty('enable_thinking')
        expect(body).not.toHaveProperty('think')
        if (effort === undefined) expect(body).not.toHaveProperty('reasoning_effort')
        else expect(body.reasoning_effort).toBe(effort)
      }
    )

    it.each([
      [{ openaiCompatible: { enable_thinking: false } }, 'off'],
      [{ openaiCompatible: { enable_thinking: true } }, 'high'],
      [{ openaiCompatible: { reasoningEffort: 'unavailable' } }, 'default'],
    ] satisfies [ProviderOptions, string][])('reads existing options %j as %s', (options, level) => {
      const runtime = new Ollama(
        { ollamaHost: 'http://localhost:11434', model: { modelId: 'local', capabilities: ['reasoning'] } },
        dependencies()
      )
      expect(runtime.readReasoningLevel(options)).toBe(level)
    })
  })
})
