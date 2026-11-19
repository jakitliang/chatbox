import { z } from 'zod'
import { ContextWindowControlUnsupportedError } from '../../models/errors'
import { getQuarterContextTarget, type ContextWindowControl } from '../context-window-control'

export const fastFlowLMModelDiscoveryQuery = 'installed=true&include=capabilities'
const catalogSchema = z.object({
  data: z.array(
    z.object({ id: z.string(), flm: z.object({ context_window_override: z.boolean().optional() }).optional() })
  ),
})

export const fastFlowLMContextControl: ContextWindowControl = {
  getTarget: getQuarterContextTarget,
  wrapFetch(fetch, tokens) {
    let verifiedModel: string | undefined
    return async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (init?.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) return fetch(input, init)
      if (typeof init.body !== 'string') throw new Error('Invalid FastFlowLM chat request for context window override')
      const body = JSON.parse(init.body)
      if (typeof body.model !== 'string') throw new Error('Missing FastFlowLM chat model for context window override')

      if (verifiedModel !== body.model) {
        const catalogUrl = new URL(url)
        catalogUrl.pathname = url.pathname.replace(/\/chat\/completions$/, '/models')
        catalogUrl.search = fastFlowLMModelDiscoveryQuery
        const response = await fetch(catalogUrl, {
          method: 'GET',
          headers: init.headers,
          signal: init.signal,
        })
        if (!response.ok) throw new Error(`Could not check FastFlowLM context window support (HTTP ${response.status})`)
        const catalog = catalogSchema.safeParse(await response.json())
        if (
          !catalog.success ||
          !catalog.data.data.some((item) => item.id === body.model && item.flm?.context_window_override === true)
        ) {
          throw new ContextWindowControlUnsupportedError()
        }
        verifiedModel = body.model
      }

      return fetch(input, { ...init, body: JSON.stringify({ ...body, num_ctx: tokens }) })
    }
  },
}
