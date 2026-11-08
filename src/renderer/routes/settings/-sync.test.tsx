// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ save: vi.fn(), upload: vi.fn(), restore: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: (selector: (state: unknown) => unknown) => selector({ appApiServer: '', setSettings: mocks.save }) }))
vi.mock('@/packages/manual-sync', () => ({ downloadManualSyncRecovery: vi.fn(), restoreManualSyncRecovery: vi.fn(), uploadManualSync: mocks.upload, restoreManualSync: mocks.restore }))
vi.mock('@/components/settings/SettingsLayout', () => ({
  SettingsPage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SettingsSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}))
import { RouteComponent } from './sync'
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('mounting, saving or clearing the address never connects or synchronizes', () => {
  render(<MantineProvider><RouteComponent /></MantineProvider>)
  fireEvent.change(screen.getByLabelText('Backend address (not the model API)'), { target: { value: '127.0.0.1:4567' } })
  fireEvent.click(screen.getByText('Save address'))
  expect(mocks.save).toHaveBeenLastCalledWith({ appApiServer: 'http://127.0.0.1:4567' })
  fireEvent.change(screen.getByLabelText('Backend address (not the model API)'), { target: { value: '' } })
  fireEvent.click(screen.getByText('Save address'))
  expect(mocks.save).toHaveBeenLastCalledWith({ appApiServer: '' })
  expect(fetch).not.toHaveBeenCalled()
  expect(mocks.upload).not.toHaveBeenCalled()
  expect(mocks.restore).not.toHaveBeenCalled()
  expect((screen.getByText('Restore from backend').closest('button') as HTMLButtonElement).disabled).toBe(true)
})