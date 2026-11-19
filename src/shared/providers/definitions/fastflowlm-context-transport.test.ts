import { describe, expect, it, vi } from 'vitest'
import { MESSAGE_ERROR_CODES } from '../../models/errors'
import { fastFlowLMContextControl } from './fastflowlm-context-transport'

const endpoint = 'http://localhost:52625/proxy/v1/chat/completions'
const body = { model: 'test:model', stream: true, max_tokens: 800, think: false }
const request = { method: 'POST', body: JSON.stringify(body), signal: new AbortController().signal }

describe('FastFlowLM context request control', () => {
  it('verifies support once per turn and forwards a scoped override without changing other fields', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    fetch.mockResolvedValueOnce(Response.json({ data: [{ id: body.model, flm: { context_window_override: true } }] }))
    fetch.mockImplementation(() => Promise.resolve(new Response()))
    const send = fastFlowLMContextControl.wrapFetch(fetch, 8192)
    await send(endpoint, request)
    await send(endpoint, request)

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(String(fetch.mock.calls[0][0])).toBe(
      'http://localhost:52625/proxy/v1/models?installed=true&include=capabilities'
    )
    expect(fetch.mock.calls[0][1]?.signal).toBe(request.signal)
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ ...body, num_ctx: 8192 })
    expect(JSON.parse(String(fetch.mock.calls[2][1]?.body))).toEqual({ ...body, num_ctx: 8192 })
  })

  it('does not send a chat request if the model has not advertised support', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json({ data: [{ id: body.model }, { id: 'other', flm: { context_window_override: true } }] })
      )
    await expect(fastFlowLMContextControl.wrapFetch(fetch, 8192)(endpoint, request)).rejects.toMatchObject({
      code: MESSAGE_ERROR_CODES.CONTEXT_WINDOW_CONTROL_UNSUPPORTED,
      message: expect.stringContaining('Select Default'),
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
