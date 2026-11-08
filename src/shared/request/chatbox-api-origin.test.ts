import { afterEach, expect, it } from 'vitest'
import { configureAppApiServer, DEFAULT_APP_API_SERVER, getChatboxAPIOrigin, normalizeAppApiServer, setDynamicChatboxAPIOrigin } from './chatbox-api-origin'
afterEach(() => configureAppApiServer(() => DEFAULT_APP_API_SERVER))
it('defaults to no backend and ignores vendor environment flags', () => {
  expect(getChatboxAPIOrigin({ USE_BETA_API: '1' })).toBe('')
})
it('reads the selected application backend live and never follows cached failover', () => {
  let selected = 'http://localhost:3002/'
  configureAppApiServer(() => selected)
  expect(getChatboxAPIOrigin()).toBe('http://localhost:3002')
  selected = 'https://selfhost.example.com'
  setDynamicChatboxAPIOrigin('https://untrusted.example.com')
  expect(getChatboxAPIOrigin()).toBe(selected)
})
it('rejects credentials, paths and invalid URLs', () => {
  for (const value of ['not-url', 'https://user:password@example.com', 'https://example.com/api', 'https://example.com/?key=value']) {
    expect(() => normalizeAppApiServer(value)).toThrow()
  }
})