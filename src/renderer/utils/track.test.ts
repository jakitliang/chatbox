import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSettingsState } = vi.hoisted(() => ({
  getSettingsState: vi.fn(),
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: getSettingsState,
  },
}))

import { trackEvent } from './track'

describe('trackEvent', () => {
  const plausible = vi.fn()

  beforeEach(() => {
    plausible.mockReset()
    getSettingsState.mockReset()
    getSettingsState.mockReturnValue({ allowReportingAndTracking: true })
    vi.stubGlobal('window', {
      location: { href: 'https://app.chatboxai.app/#/session/private-session-id' },
      plausible,
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('does not dispatch even when legacy reporting consent is enabled', () => {
    trackEvent('generate', { provider: 'openai' })
    expect(plausible).not.toHaveBeenCalled()
    expect(getSettingsState).not.toHaveBeenCalled()
  })

  it('does not track when reporting is disabled', () => {
    getSettingsState.mockReturnValue({ allowReportingAndTracking: false })

    trackEvent('generate')

    expect(plausible).not.toHaveBeenCalled()
  })

  it('does not read globals, identifiers, or props', () => {
    vi.stubGlobal('window', new Proxy({}, { get() { throw new Error('must not read globals') } }))
    const props = new Proxy({}, { get() { throw new Error('must not read properties') } })
    expect(() => trackEvent('generate', props)).not.toThrow()
  })
})
