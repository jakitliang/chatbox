import { afterEach, expect, it, vi } from 'vitest'
import { configureAppApiServer, getChatboxAPIOrigin, setDynamicChatboxAPIOrigin } from './chatbox-api-origin'
import { isChatboxAPI, reportChatboxAPINetworkError, startChatboxAPIOriginProbing, testApiOrigins } from './chatboxai_pool'

afterEach(() => {
  configureAppApiServer(() => '')
  vi.useRealTimers()
})

it('never probes or reads cached vendor origins, even through upstream startup hooks', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn()
  const storage = { get: vi.fn(), set: vi.fn() }
  const stop = startChatboxAPIOriginProbing({ fetch, storage })
  reportChatboxAPINetworkError()
  expect(await testApiOrigins()).toEqual([''])
  await vi.runAllTimersAsync()
  stop()
  expect(fetch).not.toHaveBeenCalled()
  expect(storage.get).not.toHaveBeenCalled()
  expect(storage.set).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('never replaces an explicit backend with vendor fallback', async () => {
  configureAppApiServer(() => 'https://sync.example')
  setDynamicChatboxAPIOrigin('https://api.chatboxai.com')
  reportChatboxAPINetworkError()
  expect(getChatboxAPIOrigin()).toBe('https://sync.example')
  expect(await testApiOrigins()).toEqual(['https://sync.example'])
  expect(isChatboxAPI('https://sync.example/api/sync/login')).toBe(true)
  expect(isChatboxAPI('https://api.chatboxai.com/api/login')).toBe(false)
})
