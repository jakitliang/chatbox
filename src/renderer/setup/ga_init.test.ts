// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  initSettingsStoreMock,
  isWindowFocusedMock,
  onWindowFocusedMock,
  platformInitTrackingMock,
  settingsStoreGetStateMock,
  settingsStoreSubscribeMock,
  trackingEventMock,
} = vi.hoisted(() => ({
  initSettingsStoreMock: vi.fn(),
  isWindowFocusedMock: vi.fn(async () => true),
  onWindowFocusedMock: vi.fn(),
  platformInitTrackingMock: vi.fn(async () => undefined),
  settingsStoreGetStateMock: vi.fn(),
  settingsStoreSubscribeMock: vi.fn(),
  trackingEventMock: vi.fn(),
}))

vi.mock('@/platform', () => ({
  default: {
    initTracking: platformInitTrackingMock,
    isWindowFocused: isWindowFocusedMock,
    onWindowFocused: onWindowFocusedMock,
    trackingEvent: trackingEventMock,
  },
}))
vi.mock('@/stores/settingsStore', () => ({
  initSettingsStore: initSettingsStoreMock,
  settingsStore: {
    getState: settingsStoreGetStateMock,
    subscribe: settingsStoreSubscribeMock,
  },
}))

describe('Google Analytics initialization', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    initSettingsStoreMock.mockReset()
    isWindowFocusedMock.mockClear()
    onWindowFocusedMock.mockClear()
    platformInitTrackingMock.mockClear()
    settingsStoreGetStateMock.mockReset()
    settingsStoreSubscribeMock.mockReset()
    trackingEventMock.mockClear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([true, false])('remains inert with persisted consent %s', async (allowReportingAndTracking) => {
    initSettingsStoreMock.mockResolvedValue({ allowReportingAndTracking })
    settingsStoreGetStateMock.mockReturnValue({ allowReportingAndTracking })
    const timersBefore = vi.getTimerCount()
    const { initGoogleAnalyticsTracking } = await import('./ga_init')
    await initGoogleAnalyticsTracking()
    await initGoogleAnalyticsTracking()
    expect(vi.getTimerCount()).toBe(timersBefore)
    expect(initSettingsStoreMock).not.toHaveBeenCalled()
    expect(settingsStoreGetStateMock).not.toHaveBeenCalled()
    expect(settingsStoreSubscribeMock).not.toHaveBeenCalled()
    expect(platformInitTrackingMock).not.toHaveBeenCalled()
    expect(onWindowFocusedMock).not.toHaveBeenCalled()
    expect(isWindowFocusedMock).not.toHaveBeenCalled()
    expect(trackingEventMock).not.toHaveBeenCalled()
  })
})
