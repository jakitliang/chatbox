import { describe, expect, it } from 'vitest'
import { captureAgentModeException } from './agent-mode'

describe('captureAgentModeException', () => {
  it.each([new Error('boom'), 'failure', null])('is inert for error %s', (error) => {
    expect(captureAgentModeException(error, { operation: 'generation' })).toBeUndefined()
  })

  it('does not inspect provider, model, tool names, or errors', () => {
    const context = new Proxy({ operation: 'tool_retry' as const }, {
      get() { throw new Error('must not read private context') },
    })
    expect(() => captureAgentModeException(context, context)).not.toThrow()
  })
})
