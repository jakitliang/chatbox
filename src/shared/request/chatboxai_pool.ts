import { getChatboxAPIOrigin } from './chatbox-api-origin'
export { getChatboxAPIOrigin } from './chatbox-api-origin'

/** Legacy name retained for request adapters; matches the selected self-host exactly. */
export function isChatboxAPI(input: RequestInfo | URL): boolean {
  const target = input instanceof Request ? input.url : input.toString()
  return new URL(target).origin === getChatboxAPIOrigin()
}

/** No probing, vendor failover, cached domain pool or timer. */
export async function testApiOrigins(): Promise<string[]> {
  return [getChatboxAPIOrigin()]
}

export interface ApiOriginsStorage {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

export type ApiOriginProbeFetch = (input: string, init?: RequestInit) => Promise<Response>

/** Compatibility only: upstream startup hooks must never probe official domains. */
export function startChatboxAPIOriginProbing(_options?: {
  fetch?: ApiOriginProbeFetch
  storage?: ApiOriginsStorage
}): () => void {
  return () => {}
}

/** A failed explicit request must never enable vendor failover. */
export function reportChatboxAPINetworkError(): void {}
