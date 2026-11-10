import type { LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'
import { fetchRemoteModels } from '../../../models/openai-compatible'
import type { Config, ProviderModelInfo, Settings } from '../../../types'
import { ModelProviderEnum } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { getModel, getProviderDefinition } from '../../index'
import FastFlowLM from './fastflowlm'

const reply = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data)))

function dependencies(apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>()): ModelDependencies {
  return {
    request: { apiRequest, fetchWithOptions: vi.fn() },
    storage: { saveImage: vi.fn(), getImage: vi.fn() },
    sentry: { captureException: vi.fn(), withScope: vi.fn() },
    getRemoteConfig: vi.fn(),
    platformType: 'desktop',
  }
}

const prompt: LanguageModelV4CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
}

function chatModel(model: FastFlowLM): LanguageModelV4 {
  return (model as unknown as { getChatModel(): LanguageModelV4 }).getChatModel()
}

describe('FastFlowLM independent keyless provider', () => {
  it('starts without an endpoint, credentials, predefined models or registry enrichment', () => {
    const definition = getProviderDefinition(ModelProviderEnum.FastFlowLM)
    expect(definition).toMatchObject({ name: 'FastFlowLM', defaultSettings: { apiHost: '', models: [] } })
    expect(definition?.modelsDevProviderId).toBeUndefined()
    expect(definition?.curatedModelIds).toBeUndefined()
  })

  it.each(['', '   '])('never falls back to OpenAI for an empty host (%j)', (apiHost) => {
    const deps = dependencies()
    expect(() => new FastFlowLM({ apiHost, model: { modelId: '' } }, deps)).toThrow('API host is required')
    expect(deps.request.apiRequest).not.toHaveBeenCalled()
  })

  it.each([
    [' http://localhost:52625/ ', 'http://localhost:52625/v1'],
    ['http://localhost:52625/v1/', 'http://localhost:52625/v1'],
    ['https://flm.example/proxy/v1/chat/completions', 'https://flm.example/proxy/v1'],
  ])('fetches the model catalog without authentication or native show calls (%s)', async (apiHost, baseURL) => {
    const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockImplementation(() =>
      reply({ object: 'list', data: [{ id: 'fixture-text' }, { id: 'fixture-vision' }] })
    )
    const model = new FastFlowLM({ apiHost, model: { modelId: '' }, useProxy: true }, dependencies(apiRequest))
    expect(await model.listModels()).toEqual([
      { modelId: 'fixture-text', type: 'chat' },
      { modelId: 'fixture-vision', type: 'chat' },
    ])
    expect(apiRequest).toHaveBeenCalledExactlyOnceWith({
      url: `${baseURL}/models`, method: 'GET', headers: {}, useProxy: true,
    })
  })

  it('keeps keyed OpenAI-compatible discovery authenticated', async () => {
    const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockImplementation(() => reply({ data: [] }))
    await fetchRemoteModels({ apiHost: 'https://example.test/v1', apiKey: 'fixture-key' }, dependencies(apiRequest))
    expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({ headers: { Authorization: 'Bearer fixture-key' } }))
  })

  it('uses the independent runtime and user model metadata, ignoring stored keys', () => {
    const saved: ProviderModelInfo = {
      modelId: 'fixture-local', nickname: 'My FLM', type: 'chat',
      capabilities: ['vision', 'reasoning', 'tool_use'], contextWindow: 8192, maxOutput: 512,
    }
    const runtime = getModel(
      { provider: ModelProviderEnum.FastFlowLM, modelId: saved.modelId },
      { providers: { fastflowlm: { apiHost: 'http://localhost:52625', apiKey: 'must-not-send', models: [saved] } } } as unknown as Settings,
      { uuid: '' } as Config,
      dependencies()
    ) as FastFlowLM
    expect(runtime).toBeInstanceOf(FastFlowLM)
    expect(runtime.options.apiKey).toBe('')
    expect(runtime.options.model).toMatchObject(saved)
    expect(runtime.isSupportVision()).toBe(true)
    expect(runtime.isSupportToolUse('agent')).toBe(true)
    expect(runtime.isSupportReasoning()).toBe(true)
  })

  it('sends chat completions without authentication', async () => {
    const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockImplementation(() => reply({
      id: 'fixture', object: 'chat.completion', created: 0, model: 'fixture-local',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }))
    const runtime = new FastFlowLM({ apiHost: 'http://localhost:52625', model: { modelId: 'fixture-local' } }, dependencies(apiRequest))
    const result = await chatModel(runtime).doGenerate(prompt)
    expect(result.content).toContainEqual({ type: 'text', text: 'Hello' })
    expect(apiRequest).toHaveBeenCalledOnce()
    const request = apiRequest.mock.calls[0][0]
    expect(request.url).toBe('http://localhost:52625/v1/chat/completions')
    expect(new Headers(request.headers as HeadersInit).has('authorization')).toBe(false)
    expect(JSON.parse(request.body as string).model).toBe('fixture-local')
  })

  it.each([
    { maxOutput: undefined, maxTokens: undefined },
    { maxOutput: 512, maxTokens: undefined },
    { maxOutput: undefined, maxTokens: 128 },
  ])('serializes only the explicit generation budget (%j)', async ({ maxOutput, maxTokens }) => {
    const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockResolvedValue(new Response(
      'data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } }
    ))
    const runtime = getModel(
      { provider: ModelProviderEnum.FastFlowLM, modelId: 'fixture-local', maxTokens },
      { providers: { fastflowlm: {
        apiHost: 'http://localhost:52625',
        models: [{ modelId: 'fixture-local', contextWindow: 8192, maxOutput }],
      } } } as unknown as Settings,
      { uuid: '' } as Config,
      dependencies(apiRequest)
    ) as FastFlowLM

    const parts = []
    for await (const part of runtime.chatStream([{ role: 'user', content: 'Hello' }], {})) {
      parts.push(part)
    }
    expect(parts.some((part) => part.type === 'text-delta')).toBe(true)
    expect(apiRequest).toHaveBeenCalledOnce()
    const body = JSON.parse(apiRequest.mock.calls[0][0].body as string)
    if (maxTokens === undefined) {
      expect(body).not.toHaveProperty('max_tokens')
    } else {
      expect(body.max_tokens).toBe(maxTokens)
    }
    expect(body).not.toHaveProperty('max_completion_tokens')
  })

  it('consumes reasoning and text SSE deltas without an authentication header', async () => {
    const chunks = [
      { choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'Thinking' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: null }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } },
    ]
    const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockResolvedValue(new Response(
      `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } }
    ))
    const runtime = new FastFlowLM({ apiHost: 'http://localhost:52625', model: { modelId: 'fixture-local' } }, dependencies(apiRequest))
    const { stream } = await chatModel(runtime).doStream(prompt)
    const parts = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }
    expect(parts).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'Hello' }))
    expect(parts).toContainEqual(expect.objectContaining({ type: 'reasoning-delta', delta: 'Thinking' }))
    expect(parts.some((part) => part.type === 'error')).toBe(false)
    expect(new Headers(apiRequest.mock.calls[0][0].headers as HeadersInit).has('authorization')).toBe(false)
  })
})