import { describe, expect, test } from 'vitest'
import { reportError } from './sentry'

describe('reportError', () => {
  test.each([new Error('boom'), 'failed', null, { apiKey: 'private' }])('ignores legacy error values: %s', (error) => {
    expect(reportError(error, { domain: 'application', operation: 'startup' })).toBeUndefined()
  })

  test('does not inspect error or context data', () => {
    const unreadable = new Proxy({ domain: 'session', operation: 'generation' }, {
      get() { throw new Error('must not read reporting data') },
      ownKeys() { throw new Error('must not enumerate reporting data') },
    })
    expect(() => reportError(unreadable, unreadable)).not.toThrow()
  })
})
