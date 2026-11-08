import { describe, expect, it } from 'vitest'
import { RendererSentryAdapter } from './sentry'

describe('inert renderer reporting adapter', () => {
  it('preserves scope callbacks without inspecting or storing private data', () => {
    const adapter = new RendererSentryAdapter()
    const unreadable = new Proxy({}, { get() { throw new Error('must not inspect data') } })
    expect(adapter.captureException(unreadable)).toBeUndefined()
    adapter.withScope((scope) => {
      expect(scope.setTag('private-id', 'private')).toBeUndefined()
      expect(scope.setExtra('private-data', unreadable)).toBeUndefined()
      expect(Object.keys(scope)).toEqual(['setTag', 'setExtra'])
    })
    expect(Object.keys(adapter)).toEqual([])
  })
})