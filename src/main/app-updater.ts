import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'

/** Self-hosted builds are updated manually; legacy IPC remains safe to call. */
export class AppUpdater {
  constructor(getWindow: () => BrowserWindow | null) {
    ipcMain.removeHandler('updater:check')
    ipcMain.handle('updater:check', () => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('updater:not-available')
      }
      return { started: false }
    })
    ipcMain.removeHandler('install-update')
    ipcMain.handle('install-update', () => undefined)
  }

  async tryUpdate(): Promise<null> {
    return null
  }
}
