import { generateId } from '@ai-sdk/provider-utils'
import { headersToRecord } from '../../oauth/fetch-utils'

const chatCompletionsPath = /\/v1\/chat\/completions\/?$/
const samplingKeys = [
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'seed',
  'presence_penalty',
  'frequency_penalty',
  'repeat_penalty',
] as const

interface CompatibleRequest extends Partial<Record<(typeof samplingKeys)[number], number>> {
  model: string
  messages: {
    role: string
    content?: string | null | { type: string; text?: string; image_url?: { url: string } | string }[]
    reasoning_content?: string
    reasoning?: string
    name?: string
    tool_call_id?: string
    tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[]
  }[]
  tools?: unknown[]
  tool_choice?: unknown
  stream?: boolean
  stream_options?: { include_usage?: boolean }
  think?: boolean | string
  enable_thinking?: boolean
  reasoning_effort?: string
  stop?: string | string[]
  max_tokens?: number
  max_completion_tokens?: number
  response_format?: { type: string; json_schema?: { schema: unknown } }
  logprobs?: boolean
  top_logprobs?: number
}

interface NativeToolCall {
  id?: string
  function: { name: string; arguments: unknown }
}

interface NativeResponse {
  model?: string
  created_at?: string
  message?: { content?: string; thinking?: string; tool_calls?: NativeToolCall[] }
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
  logprobs?: unknown[]
  error?: string
}

function toNativeMessages(messages: CompatibleRequest['messages']) {
  const toolNames = new Map<string, string>()
  return messages.map((message) => {
    let content = ''
    const images: string[] = []
    if (typeof message.content === 'string') content = message.content
    else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'text') {
          content += part.text ?? ''
        } else if (part.type === 'image_url') {
          const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url
          const base64 = url?.match(/^data:image\/[^;,]+(?:;[^;,]+)*;base64,([A-Za-z0-9+/]+=*)$/i)?.[1]
          if (!base64) throw new Error('Ollama vision requires a base64 image data URL')
          images.push(base64)
        } else {
          throw new Error(`Ollama chat does not support message part type "${part.type}"`)
        }
      }
    }

    return {
      role: message.role === 'developer' ? 'system' : message.role,
      content,
      thinking: message.reasoning_content ?? message.reasoning,
      images: images.length ? images : undefined,
      tool_calls: message.tool_calls?.map((call, index) => {
        const args: unknown = JSON.parse(call.function.arguments)
        if (call.type !== 'function' || !args || typeof args !== 'object' || Array.isArray(args)) {
          throw new Error(`Invalid Ollama function call arguments for "${call.function.name}"`)
        }
        toolNames.set(call.id, call.function.name)
        return { id: call.id, function: { index, name: call.function.name, arguments: args } }
      }),
      tool_call_id: message.tool_call_id,
      tool_name: message.role === 'tool' ? message.name || toolNames.get(message.tool_call_id ?? '') : undefined,
    }
  })
}

function toNativeRequest(body: CompatibleRequest, numCtx: number) {
  const options = {
    num_ctx: numCtx,
    num_predict: body.max_completion_tokens ?? body.max_tokens,
    stop: typeof body.stop === 'string' ? [body.stop] : body.stop,
    ...Object.fromEntries(samplingKeys.map((key) => [key, body[key]])),
  }
  const effort = body.reasoning_effort
  return {
    model: body.model,
    messages: toNativeMessages(body.messages),
    tools: body.tool_choice === 'none' ? undefined : body.tools,
    stream: body.stream === true, // Ollama defaults to streaming; OpenAI does not.
    think: body.think ?? body.enable_thinking ?? (effort === 'none' ? false : effort || undefined),
    format: body.response_format?.type === 'json_object' ? 'json' : body.response_format?.json_schema?.schema,
    logprobs: body.logprobs,
    top_logprobs: body.top_logprobs,
    options,
  }
}

function completionMetadata(model: string) {
  const id = `chatcmpl-${generateId()}`
  const now = Math.floor(Date.now() / 1000)
  let created: number | undefined
  let resolvedModel = model
  return (object: 'chat.completion' | 'chat.completion.chunk', frame: NativeResponse) => {
    if (created === undefined) {
      const timestamp = Date.parse(frame.created_at ?? '')
      created = Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : now
      resolvedModel = frame.model ?? model
    }
    return { id, object, model: resolvedModel, created }
  }
}

function toToolCall(call: NativeToolCall) {
  return {
    id: call.id || `call_${generateId()}`,
    type: 'function',
    function: { name: call.function.name, arguments: JSON.stringify(call.function.arguments ?? {}) },
  }
}

function finishReason(frame: NativeResponse, hasToolCalls: boolean) {
  return frame.done_reason === 'length' ? 'length' : hasToolCalls ? 'tool_calls' : frame.done_reason || 'stop'
}

function toUsage(frame: NativeResponse) {
  if (frame.prompt_eval_count === undefined && frame.eval_count === undefined) return undefined
  const prompt = frame.prompt_eval_count ?? 0
  const completion = frame.eval_count ?? 0
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
}

function toLogprobs(frame: NativeResponse) {
  return frame.logprobs?.length ? { content: frame.logprobs } : undefined
}

function toCompletion(frame: NativeResponse, model: string) {
  const calls = frame.message?.tool_calls?.map(toToolCall)
  return {
    ...completionMetadata(model)('chat.completion', frame),
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: frame.message?.content ?? '',
          reasoning_content: frame.message?.thinking,
          tool_calls: calls,
        },
        finish_reason: finishReason(frame, !!calls?.length),
        logprobs: toLogprobs(frame),
      },
    ],
    usage: toUsage(frame),
  }
}

function errorEnvelope(message: string) {
  return { error: { message, type: 'ollama_error' } }
}

function toCompletionSse(body: NonNullable<Response['body']>, request: CompatibleRequest) {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const metadata = completionMetadata(request.model)
  let buffer = ''
  let toolCount = 0
  let sentRole = false
  let finished = false

  const encode = (data: unknown) =>
    encoder.encode(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`)
  const convertLine = (line: string, emit: (data: unknown) => void) => {
    if (!line.trim()) return
    let frame: NativeResponse
    try {
      frame = JSON.parse(line)
    } catch {
      frame = { error: 'Ollama returned invalid NDJSON' }
    }
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
      frame = { error: 'Ollama returned an invalid chat response' }
    }
    if (typeof frame.error === 'string') {
      emit(errorEnvelope(frame.error))
      finished = true
      return
    }

    const info = metadata('chat.completion.chunk', frame)
    const message = frame.message
    // Native Ollama emits complete calls, not argument deltas. Index them in
    // arrival order, since separate native chunks can reuse function.index.
    const calls = message?.tool_calls?.map((call) => ({ index: toolCount++, ...toToolCall(call) }))
    const logprobs = toLogprobs(frame)
    if (!sentRole || message?.content || message?.thinking || calls?.length || logprobs) {
      emit({
        ...info,
        choices: [
          {
            index: 0,
            delta: {
              role: sentRole ? undefined : 'assistant',
              content: message?.content || undefined,
              reasoning_content: message?.thinking || undefined,
              tool_calls: calls,
            },
            finish_reason: null,
            logprobs,
          },
        ],
      })
      sentRole = true
    }
    if (frame.done === true) {
      emit({ ...info, choices: [{ index: 0, delta: {}, finish_reason: finishReason(frame, toolCount > 0) }] })
      const usage = toUsage(frame)
      if (usage && request.stream_options?.include_usage !== false) emit({ ...info, choices: [], usage })
      emit('[DONE]')
      finished = true
    }
  }

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })
        let newline = buffer.indexOf('\n')
        while (newline !== -1) {
          convertLine(buffer.slice(0, newline), (data) => controller.enqueue(encode(data)))
          if (finished) {
            // Ollama's done frame is authoritative even when a proxy holds the connection open.
            controller.terminate()
            return
          }
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
        }
      },
      flush(controller) {
        buffer += decoder.decode()
        convertLine(buffer, (data) => controller.enqueue(encode(data)))
        if (!finished) controller.enqueue(encode(errorEnvelope('Ollama stream ended before its final chat frame')))
      },
    })
  )
}

function responseHeaders(response: Response, contentType: string) {
  const headers = new Headers(response.headers)
  for (const key of ['content-length', 'content-encoding', 'transfer-encoding', 'etag']) headers.delete(key)
  headers.set('content-type', contentType)
  return headers
}

function jsonResponse(response: Response, data: unknown, status = response.status) {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === response.status ? response.statusText : undefined,
    headers: responseHeaders(response, 'application/json'),
  })
}

/** Route only explicit-context chat completions through Ollama's native API. */
export function createOllamaContextFetch(fetch: typeof globalThis.fetch, numCtx: number): typeof globalThis.fetch {
  if (!Number.isSafeInteger(numCtx) || numCtx <= 0) throw new Error('Ollama context length must be a positive integer')
  return async (input, init) => {
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined
    if ((init?.method ?? request?.method ?? 'GET').toUpperCase() !== 'POST') return fetch(input, init)
    let url: URL
    try {
      url = new URL(request?.url ?? input.toString())
    } catch {
      return fetch(input, init)
    }
    if (!chatCompletionsPath.test(url.pathname)) return fetch(input, init)

    const payload = typeof init?.body === 'string' ? init.body : await new Request(input, init).text()
    const body: CompatibleRequest = JSON.parse(payload)
    const nativeBody = toNativeRequest(body, numCtx)
    url.pathname = url.pathname.replace(chatCompletionsPath, '/api/chat')
    const headers = new Headers(init?.headers ?? request?.headers)
    headers.delete('content-length')
    headers.set('content-type', 'application/json')
    headers.set('accept', nativeBody.stream ? 'application/x-ndjson' : 'application/json')
    const response = await fetch(url.toString(), {
      ...(request && {
        cache: request.cache,
        credentials: request.credentials,
        integrity: request.integrity,
        keepalive: request.keepalive,
        mode: request.mode,
        redirect: request.redirect,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
      }),
      ...init,
      method: 'POST',
      // The supplied fetch can be Chatbox's proxy shim, which expects a plain header record.
      headers: headersToRecord(headers),
      signal: init?.signal === undefined ? request?.signal : init.signal,
      body: JSON.stringify(nativeBody),
    })
    if (!response.ok) {
      if (!response.headers.get('content-type')?.includes('application/json')) return response
      const data: NativeResponse | null = await response
        .clone()
        .json()
        .catch(() => null)
      return typeof data?.error === 'string' ? jsonResponse(response, errorEnvelope(data.error)) : response
    }
    if (nativeBody.stream) {
      if (!response.body) throw new Error('Ollama returned no chat stream')
      return new Response(toCompletionSse(response.body, body) as never, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders(response, 'text/event-stream; charset=utf-8'),
      })
    }
    const frame: NativeResponse = await response.json()
    if (typeof frame?.error === 'string') return jsonResponse(response, errorEnvelope(frame.error), 502)
    if (!frame?.message) throw new Error('Ollama returned no chat message')
    return jsonResponse(response, toCompletion(frame, body.model))
  }
}
