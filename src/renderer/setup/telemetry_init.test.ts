// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { initSettingsStoreMock, settingsStoreGetStateMock, settingsStoreSubscribeMock } = vi.hoisted(() => ({
  initSettingsStoreMock: vi.fn(async () => ({ allowReportingAndTracking: false })),
  settingsStoreGetStateMock: vi.fn(() => ({ allowReportingAndTracking: false })),
  settingsStoreSubscribeMock: vi.fn(),
}))

vi.mock('@/analytics/jk', () => ({
  initJkAnalytics: vi.fn(),
  trackJkViewEvent: vi.fn(),
}))
vi.mock('@/analytics/jk-events', () => ({ JK_EVENTS: { APP_LAUNCH: 'app_launch' } }))
vi.mock('@/stores/settingsStore', () => ({
  initSettingsStore: initSettingsStoreMock,
  settingsStore: {
    getState: settingsStoreGetStateMock,
    subscribe: settingsStoreSubscribeMock,
  },
}))
vi.mock('../platform', () => ({
  default: {
    getVersion: vi.fn(async () => '1.0.0'),
    onWindowFocused: vi.fn(),
  },
}))

describe('permanently disabled telemetry initialization', () => {
  beforeEach(() => {
    initSettingsStoreMock.mockClear()
    settingsStoreGetStateMock.mockReset()
    settingsStoreGetStateMock.mockReturnValue({ allowReportingAndTracking: false })
    settingsStoreSubscribeMock.mockClear()
    window.plausible = undefined
    window.history.replaceState({}, '', '/')
    vi.resetModules()
  })

  it('does not hydrate settings as an import side effect', async () => {
    await Promise.all([import('./ga_init'), import('./jk_analytics_init'), import('./plausible_init')])

    expect(initSettingsStoreMock).not.toHaveBeenCalled()
  })

  it('does not hydrate settings or subscribe even when explicitly initialized', async () => {
    const [{ initGoogleAnalyticsTracking }, { initJkTracking }, { initPlausibleTracking }, { initSentry }] = await Promise.all([
      import('./ga_init'),
      import('./jk_analytics_init'),
      import('./plausible_init'),
      import('./sentry_init'),
    ])

    await initGoogleAnalyticsTracking()
    await initPlausibleTracking()
    await initJkTracking()

    expect(await initSentry()).toBe(false)
    expect(initSettingsStoreMock).not.toHaveBeenCalled()
    expect(settingsStoreGetStateMock).not.toHaveBeenCalled()
    expect(settingsStoreSubscribeMock).not.toHaveBeenCalled()
  })

  it('does not subscribe to navigation or dispatch pageviews with consent enabled', async () => {
    initSettingsStoreMock.mockResolvedValueOnce({ allowReportingAndTracking: true })
    settingsStoreGetStateMock.mockReturnValue({ allowReportingAndTracking: true })
    const plausibleMock = vi.fn()
    const navigationSubscriber = vi.fn()
    window.plausible = plausibleMock

    const { initPlausibleTracking } = await import('./plausible_init')
    await initPlausibleTracking(navigationSubscriber)

    expect(navigationSubscriber).not.toHaveBeenCalled()
    expect(plausibleMock).not.toHaveBeenCalled()
    expect(window.plausible).toBe(plausibleMock)
  })

  it('does not track private routes or retain navigation callbacks', async () => {
    initSettingsStoreMock.mockResolvedValueOnce({ allowReportingAndTracking: true })
    settingsStoreGetStateMock.mockReturnValue({ allowReportingAndTracking: true })
    const plausibleMock = vi.fn()
    let onNavigationResolved: ((hrefChanged: boolean) => void) | undefined
    window.plausible = plausibleMock
    window.history.replaceState({}, '', '/#/session/session-a')

    const { initPlausibleTracking } = await import('./plausible_init')
    await initPlausibleTracking((callback) => {
      onNavigationResolved = callback
    })

    window.history.replaceState({}, '', '/#/session/session-b')
    onNavigationResolved?.(true)
    expect(onNavigationResolved).toBeUndefined()
    expect(plausibleMock).not.toHaveBeenCalled()

    window.history.replaceState({}, '', '/#/settings/general')
    onNavigationResolved?.(true)
    expect(plausibleMock).not.toHaveBeenCalled()
  })

  it('does not initialize JK analytics or emit launch events', async () => {
    initSettingsStoreMock.mockResolvedValueOnce({ allowReportingAndTracking: true })
    settingsStoreGetStateMock.mockReturnValue({ allowReportingAndTracking: true })
    const { initJkAnalytics, trackJkViewEvent } = await import('@/analytics/jk')
    const { initJkTracking } = await import('./jk_analytics_init')
    await initJkTracking()
    expect(initJkAnalytics).not.toHaveBeenCalled()
    expect(trackJkViewEvent).not.toHaveBeenCalled()
  })
})
