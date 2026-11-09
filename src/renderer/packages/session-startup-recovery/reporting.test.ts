import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createStartupDiagnostic } from './diagnostics'
const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  allowed: true,
  capture: vi.fn(),
  on: vi.fn(),
  clear: vi.fn(),
  tags: vi.fn(),
  processor: vi.fn(),
  unsubscribe: vi.fn(),
}))
vi.mock('@/setup/sentry_init', () => ({ initSentry: mocks.init }))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ allowReportingAndTracking: mocks.allowed }) },
}))
vi.mock('@/platform', () => ({
  default: { type: 'mobile', getVersion: async () => '1.24.0', getPlatform: async () => 'android' },
}))
vi.mock('@sentry/react', () => ({
  getClient: () => ({ on: mocks.on }),
  withScope: (
    callback: (scope: {
      clear: typeof mocks.clear
      setTags: typeof mocks.tags
      addEventProcessor: typeof mocks.processor
    }) => void
  ) => callback({ clear: mocks.clear, setTags: mocks.tags, addEventProcessor: mocks.processor }),
  captureException: mocks.capture,
}))
let callback: (event: { event_id: string }, response: { statusCode: number }) => void
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.allowed = true
  mocks.init.mockResolvedValue(true)
  mocks.capture.mockReturnValue('event-1')
  mocks.on.mockImplementation((_hook, cb) => {
    callback = cb
    return mocks.unsubscribe
  })
})
afterEach(() => vi.useRealTimers())

it('does not send even sanitized startup errors', async () => {
  const { reportStartupFailure } = await import('./reporting')
  const diagnostic = createStartupDiagnostic(new Error('Active thread projection is unavailable'), 'read')
  const report = reportStartupFailure('private-session', diagnostic)
  await expect(report).resolves.toBeUndefined()
  expect(mocks.capture).not.toHaveBeenCalled()
})

it('does not claim delivery on a failed transport response', async () => {
  const { reportStartupFailure } = await import('./reporting')
  const report = reportStartupFailure('s', createStartupDiagnostic(new Error('database is locked'), 'read'))
  expect(mocks.capture).not.toHaveBeenCalled()
  await expect(report).resolves.toBeUndefined()
})

it('honors the reporting preference', async () => {
  mocks.allowed = false
  const { reportStartupFailure } = await import('./reporting')
  await expect(
    reportStartupFailure('s', createStartupDiagnostic(new Error('database is locked'), 'read'))
  ).resolves.toBeUndefined()
  expect(mocks.capture).not.toHaveBeenCalled()
})

it('cannot enable reporting through a legacy preference', async () => {
  mocks.allowed = false
  const { reportStartupFailure } = await import('./reporting')
  const diagnostic = createStartupDiagnostic(new Error('database is locked'), 'read')
  await expect(reportStartupFailure('s', diagnostic)).resolves.toBeUndefined()
  mocks.allowed = true
  const report = reportStartupFailure('s', diagnostic)
  await expect(report).resolves.toBeUndefined()
  expect(mocks.capture).not.toHaveBeenCalled()
})

it('keeps startup diagnostics local without initializing telemetry', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  try {
    const { reportStartupFailure } = await import('./reporting')
    await expect(reportStartupFailure('private-session', createStartupDiagnostic(new Error('database is locked'), 'read'))).resolves.toBeUndefined()
    expect(mocks.init).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  } finally { fetch.mockRestore() }
})
