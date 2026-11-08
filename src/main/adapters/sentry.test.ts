import { describe, expect, it } from 'vitest'
import { MainSentryAdapter, flushSentry, sentry } from './sentry'

describe('inert main reporting adapter', () => {
  it('preserves scope callbacks without storing error/context data', async () => {
    const unreadable = new Proxy({}, { get() { throw new Error('must not inspect data') } })
    for (const adapter of [sentry, new MainSentryAdapter()]) {
      expect(adapter.captureException(unreadable)).toBeUndefined()
      adapter.withScope((scope) => {
        expect(scope.setTag('private-id', 'private')).toBeUndefined()
        expect(scope.setExtra('private-data', unreadable)).toBeUndefined()
        expect(Object.keys(scope)).toEqual(['setTag', 'setExtra'])
      })
      expect(Object.keys(adapter)).toEqual([])
    }
    expect(await flushSentry(2000)).toBe(true)
  })
})