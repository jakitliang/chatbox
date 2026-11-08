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
