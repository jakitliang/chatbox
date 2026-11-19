import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'
import { createFetchWithProxy } from '../../models/utils/fetch-proxy'
import { createOpenAIChatCompletionSseFetch } from '../../models/utils/openai-chat-sse-termination'
import type { ModelDependencies } from '../../types/adapters'
import { createOllamaContextFetch } from './ollama-context-transport'

const baseURL = 'https://ollama.example/proxy/v1'
const endpoint = `${baseURL}/chat/completions`
const nativeRequest = { model: 'test-model', messages: [] }
const nativeMessage = { model: 'resolved-model', message: { role: 'assistant', content: 'ok' }, done: true }
const encoder = new TextEncoder()

function post(overrides: object = {}, init?: RequestInit): RequestInit {
  return { method: 'POST', body: JSON.stringify({ ...nativeRequest, ...overrides }), ...init }
}

function ndjson(...frames: object[]) {
  return new Response(frames.map((frame) => JSON.stringify(frame)).join('\n'), {
    headers: { 'content-type': 'application/x-ndjson' },
  })
}

describe('createOllamaContextFetch', () => {
  it('passes other endpoints and methods through untouched', async () => {
    const response = new Response('passthrough')
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
    const wrapped = createOllamaContextFetch(fetch, 8192)
    const embedding = new URL(`${baseURL}/embeddings`)
    const init = post()
    expect(await wrapped(embedding, init)).toBe(response)
    expect(fetch).toHaveBeenLastCalledWith(embedding, init)
    expect(await wrapped(endpoint)).toBe(response)
    expect(fetch).toHaveBeenLastCalledWith(endpoint, undefined)
    expect(await wrapped('https://ollama.example/custom/chat/completions', init)).toBe(response)
    expect(fetch).toHaveBeenLastCalledWith('https://ollama.example/custom/chat/completions', init)
  })

  it('rewrites through the existing proxy fetch and preserves history and generation settings', async () => {
    const apiRequest = vi
      .fn<ModelDependencies['request']['apiRequest']>()
      .mockResolvedValue(Response.json(nativeMessage))
    const baseFetch = createFetchWithProxy(true, {
      request: { apiRequest, fetchWithOptions: vi.fn() },
      storage: { saveImage: vi.fn(), getImage: vi.fn() },
      sentry: { captureException: vi.fn(), withScope: vi.fn() },
      getRemoteConfig: vi.fn(),
    })
    const wrapped = createOllamaContextFetch(baseFetch, 16384)
    const controller = new AbortController()
    const schema = { type: 'object', properties: { answer: { type: 'string' } } }
    const tool = { type: 'function', function: { name: 'lookup', parameters: schema } }
    const history = [
      { role: 'system', content: 'system' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'one ' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,eA==' } },
          { type: 'text', text: 'two' },
          { type: 'image_url', image_url: { url: 'data:image/webp;base64,eQ==' } },
        ],
      },
      {
        role: 'assistant',
        reasoning_content: 'previous thinking',
        content: null,
        tool_calls: [
          { id: 'a', type: 'function', function: { name: 'lookup', arguments: '{"q":1}' } },
          { id: 'b', type: 'function', function: { name: 'other', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'b', content: '{"found":true}' },
      { role: 'tool', tool_call_id: 'a', content: 'result' },
    ]
    await wrapped(
      `${endpoint}/?trace=abc`,
      post(
        {
          messages: history,
          tools: [tool],
          reasoning_effort: 'custom-level',
          max_tokens: 70,
          max_completion_tokens: 60,
          stop: 'END',
          temperature: 0,
          top_p: 0.8,
          top_k: 12,
          min_p: 0.05,
          seed: 0,
          frequency_penalty: 0.1,
          presence_penalty: -0.2,
          response_format: { type: 'json_schema', json_schema: { name: 'result', schema } },
        },
        {
          signal: controller.signal,
          headers: { Authorization: 'Bearer test', 'X-Proxy-Key': 'test', 'Content-Length': '22' },
        }
      )
    )
    const [request] = apiRequest.mock.calls[0]
    expect(request).toMatchObject({
      url: 'https://ollama.example/proxy/api/chat?trace=abc',
      method: 'POST',
      useProxy: true,
      retry: 0,
      headers: { authorization: 'Bearer test', 'x-proxy-key': 'test', 'content-type': 'application/json' },
    })
    expect(request.signal).toBe(controller.signal)
    expect(request.headers).not.toHaveProperty('content-length')
    expect(JSON.parse(String(request.body))).toEqual({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'one two', images: ['eA==', 'eQ=='] },
        {
          role: 'assistant',
          content: '',
          thinking: 'previous thinking',
          tool_calls: [
            { id: 'a', function: { index: 0, name: 'lookup', arguments: { q: 1 } } },
            { id: 'b', function: { index: 1, name: 'other', arguments: {} } },
          ],
        },
        { role: 'tool', tool_call_id: 'b', tool_name: 'other', content: '{"found":true}' },
        { role: 'tool', tool_call_id: 'a', tool_name: 'lookup', content: 'result' },
      ],
      tools: [tool],
      stream: false,
      think: 'custom-level',
      format: schema,
      options: {
        num_ctx: 16384,
        num_predict: 60,
        temperature: 0,
        top_p: 0.8,
        top_k: 12,
        min_p: 0.05,
        seed: 0,
        stop: ['END'],
        frequency_penalty: 0.1,
        presence_penalty: -0.2,
      },
    })
  })

  it.each([
    [{}, undefined],
    [{ reasoning_effort: 'none' }, false],
    [{ reasoning_effort: 'high' }, 'high'],
    [{ enable_thinking: true }, true],
    [{ think: false, reasoning_effort: 'high' }, false],
  ])('preserves explicit thinking and leaves it absent by default (%j)', async (thinking, expected) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(nativeMessage))
    const wrapped = createOllamaContextFetch(fetch, 1024)
    const request = new Request(endpoint, post(thinking, { headers: { 'X-Request': 'kept' } }))
    await wrapped(request)
    const [, init] = fetch.mock.calls[0]
    expect(init?.signal).toBe(request.signal)
    expect(init?.headers).toHaveProperty('x-request', 'kept')
    const sent = JSON.parse(String(init?.body))
    if (expected === undefined) expect(sent).not.toHaveProperty('think')
    else expect(sent.think).toBe(expected)
  })

  it('translates nonstream output into the existing SDK’s text, reasoning, tools and usage', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        ...nativeMessage,
        message: {
          ...nativeMessage.message,
          thinking: 'consider',
          tool_calls: [{ id: 'call_native', function: { name: 'lookup', arguments: { q: 'a' } } }],
        },
        done_reason: 'stop',
        prompt_eval_count: 7,
        eval_count: 3,
      })
    )
    const model = createOpenAICompatible({
      name: 'ollama',
      baseURL,
      supportsStructuredOutputs: true,
      fetch: createOpenAIChatCompletionSseFetch(createOllamaContextFetch(fetch, 8192)),
    }).chatModel('test-model')

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 123,
      responseFormat: { type: 'json' },
    })
    expect(result.content).toEqual([
      { type: 'text', text: 'ok' },
      { type: 'reasoning', text: 'consider' },
      { type: 'tool-call', toolCallId: 'call_native', toolName: 'lookup', input: '{"q":"a"}' },
    ])
    expect(result.finishReason.unified).toBe('tool-calls')
    expect(result.usage.inputTokens.total).toBe(7)
    expect(result.usage.outputTokens.total).toBe(3)
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      format: 'json',
      options: { num_ctx: 8192, num_predict: 123 },
    })
  })

  it('streams split UTF-8/NDJSON through the SDK with ordered complete tool calls and final usage', async () => {
    const raw = encoder.encode(
      [
        { ...nativeMessage, message: { thinking: '思考' }, done: false },
        { message: { content: 'hello' }, done: false },
        { message: { tool_calls: [{ function: { index: 0, name: 'first', arguments: { x: 1 } } }] }, done: false },
        {
          message: { tool_calls: [{ id: 'call_second', function: { index: 0, name: 'second', arguments: {} } }] },
          done: false,
        },
        { message: { content: '!' }, done: true, done_reason: 'stop', prompt_eval_count: 4, eval_count: 5 },
      ]
        .map((frame) => JSON.stringify(frame))
        .join('\r\n\r\n')
    )
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < raw.length; i++) controller.enqueue(raw.subarray(i, i + 1))
              controller.close()
            },
          })
        )
    )
    const model = createOpenAICompatible({
      name: 'ollama',
      baseURL,
      fetch: createOpenAIChatCompletionSseFetch(createOllamaContextFetch(fetch, 8192)),
    }).chatModel('test-model')
    const { stream } = await model.doStream({ prompt: [] })
    const chunks: LanguageModelV4StreamPart[] = []
    const reader = stream.getReader()
    for (let read = await reader.read(); !read.done; read = await reader.read()) chunks.push(read.value)
    expect(chunks.filter((part) => part.type === 'error')).toEqual([])
    expect(chunks.filter((part) => part.type === 'reasoning-delta')).toMatchObject([{ delta: '思考' }])
    expect(chunks.filter((part) => part.type === 'text-delta')).toMatchObject([{ delta: 'hello' }, { delta: '!' }])
    expect(chunks.filter((part) => part.type === 'tool-call')).toMatchObject([
      { toolCallId: expect.stringMatching(/^call_/), toolName: 'first', input: '{"x":1}' },
      { toolCallId: 'call_second', toolName: 'second', input: '{}' },
    ])
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      finishReason: { unified: 'tool-calls' },
      usage: { inputTokens: { total: 4 }, outputTokens: { total: 5 } },
    })
  })

  it('emits [DONE] once, preserves length and metadata, and cancels an open upstream body', async () => {
    const cancel = vi.fn()
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('{"message":{"content":"hi"},"done":true,"done_reason":"length"}\n'))
            },
            cancel,
          }),
          { headers: { 'Content-Length': '150', 'Content-Encoding': 'gzip', 'X-Trace': 'test' } }
        )
    )
    const result = await createOllamaContextFetch(fetch, 8192)(endpoint, post({ stream: true }))
    expect(result.headers.get('content-type')).toContain('text/event-stream')
    expect(result.headers.get('content-length')).toBeNull()
    expect(result.headers.get('content-encoding')).toBeNull()
    expect(result.headers.get('x-trace')).toBe('test')
    const text = await result.text()
    expect(text.match(/data: \[DONE\]/g)).toHaveLength(1)
    expect(text).toContain('"finish_reason":"length"')
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it('propagates downstream cancellation and network abort errors', async () => {
    const cancel = vi.fn()
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('{"message":{"content":"hi"},"done":false}\n'))
          },
          cancel,
        })
      )
    )
    const wrapped = createOllamaContextFetch(fetch, 8192)
    const result = await wrapped(endpoint, post({ stream: true }))
    const reader = result.body?.getReader()
    expect(await reader?.read()).toMatchObject({ done: false })
    await reader?.cancel('cancelled')
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('cancelled'))

    const error = new DOMException('Aborted', 'AbortError')
    const controller = new AbortController()
    controller.abort(error)
    fetch.mockImplementationOnce((_url, init) => {
      expect(init?.signal).toBe(controller.signal)
      return Promise.reject(error)
    })
    await expect(wrapped(endpoint, post({}, { signal: controller.signal }))).rejects.toBe(error)
  })

  it('preserves non-native HTTP failures and translates native HTTP/in-band errors', async () => {
    const proxyError = new Response('gateway trouble', { status: 503 })
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(proxyError)
      .mockResolvedValueOnce(
        Response.json({ error: 'model missing' }, { status: 404, headers: { 'x-request-id': 'test' } })
      )
      .mockResolvedValueOnce(ndjson({ message: { content: 'partial' } }, { error: 'overloaded' }))
      .mockResolvedValueOnce(ndjson({ message: { content: 'truncated' } }))
    const wrapped = createOllamaContextFetch(fetch, 8192)
    expect(await wrapped(endpoint, post())).toBe(proxyError)
    const nativeError = await wrapped(endpoint, post())
    expect(nativeError.status).toBe(404)
    expect(nativeError.headers.get('x-request-id')).toBe('test')
    expect(await nativeError.json()).toMatchObject({ error: { message: 'model missing' } })
    const streamError = await (await wrapped(endpoint, post({ stream: true }))).text()
    expect(streamError).toContain('"content":"partial"')
    expect(streamError).toContain('"message":"overloaded"')
    expect(streamError).not.toContain('[DONE]')
    expect(await (await wrapped(endpoint, post({ stream: true }))).text()).toContain(
      'Ollama stream ended before its final chat frame'
    )
  })
})
