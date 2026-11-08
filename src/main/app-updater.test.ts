import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, removeHandler } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  removeHandler: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler,
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
  },
}))

import { AppUpdater } from './app-updater'

describe('disabled updater compatibility', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('registers inert check/install handlers without startup timers', async () => {
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow
    const updater = new AppUpdater(() => win)
    expect(vi.getTimerCount()).toBe(0)
    expect(await updater.tryUpdate()).toBeNull()
    expect(await handlers.get('updater:check')?.()).toEqual({ started: false })
    expect(send).toHaveBeenCalledWith('updater:not-available')
    expect(handlers.get('install-update')?.()).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('tolerates missing/destroyed windows and repeated registration', () => {
    new AppUpdater(() => null)
    expect(handlers.get('updater:check')?.()).toEqual({ started: false })
    const send = vi.fn()
    new AppUpdater(() => ({ isDestroyed: () => true, webContents: { send } }) as unknown as BrowserWindow)
    expect(handlers.get('updater:check')?.()).toEqual({ started: false })
    expect(send).not.toHaveBeenCalled()
    expect(removeHandler).toHaveBeenCalledTimes(4)
  })
})