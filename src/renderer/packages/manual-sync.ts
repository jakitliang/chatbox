import { rendererBackupService } from '@/app/renderer-backup'
import { ManualSyncClient, type SyncProgress } from './manual-sync/http'
import { readSyncRecovery, saveSyncRecovery } from './manual-sync/recovery'
import { readFullSnapshotScope, snapshotToZip, syncT as t, zipToSnapshot } from './manual-sync/snapshot'

export { requireSyncAddress } from './manual-sync/http'
let active = false
async function exclusive<T>(action: () => Promise<T>): Promise<T> {
  if (active || rendererBackupService.isActive()) throw new Error(t('A backup or sync is in progress. Please wait.'))
  active = true
  try { return await action() } finally { active = false }
}
export function uploadManualSync(address: string, username: string, password: string, progress: SyncProgress) {
  return exclusive(async () => {
    const client = new ManualSyncClient(address)
    progress(t('Creating a complete local V3 backup'), 0)
    const { bytes } = await rendererBackupService.exportBytes()
    await readFullSnapshotScope(bytes)
    progress(t('Packaging a standalone SQLite snapshot'), 0)
    await client.upload(await zipToSnapshot(bytes), username, password, progress)
  })
}
export function restoreManualSync(address: string, username: string, password: string, progress: SyncProgress) {
  return exclusive(async () => {
    const sqlite = await new ManualSyncClient(address).download(username, password, progress)
    progress(t('Validating SQLite, V3 records and conversation structure'), 0)
    const zip = await snapshotToZip(sqlite)
    const scope = await readFullSnapshotScope(zip)
    await rendererBackupService.validateSyncBackup(zip)
    progress(t('Saving a local recovery backup before replacement'), 0)
    const recovery = await rendererBackupService.exportBytes()
    await saveSyncRecovery(recovery.bytes)
    progress(t('Replacing local data within the snapshot scope'), 0)
    await rendererBackupService.replaceSyncBackup(zip, scope.sessionIds, scope.sharedKeys)
    progress(t('Replacement restore complete'), 100)
  })
}
/** Local recovery repeats the same preflight/replacement logic, with no network access. */
export function restoreManualSyncRecovery(progress: SyncProgress) {
  return exclusive(async () => {
    const recovery = await readSyncRecovery()
    if (!recovery) throw new Error(t('No local pre-replacement recovery backup is available.'))
    progress(t('Validating the local recovery backup'), 0)
    const scope = await readFullSnapshotScope(recovery.zip)
    await rendererBackupService.validateSyncBackup(recovery.zip)
    progress(t('Restoring local data from before replacement'), 0)
    await rendererBackupService.replaceSyncBackup(recovery.zip, scope.sessionIds, scope.sharedKeys)
    progress(t('Local recovery complete'), 100)
  })
}
/** Explicit local action; never contacts the server or overwrites data. */
export async function downloadManualSyncRecovery() {
  const recovery = await readSyncRecovery()
  if (!recovery) throw new Error(t('No local pre-replacement recovery backup is available.'))
  const blob = new Blob([recovery.zip.slice().buffer], { type: 'application/zip' })
  const link = document.createElement('a'), url = URL.createObjectURL(blob)
  link.href = url
  link.download = `chatbox-before-sync-${recovery.createdAt.replace(/[:.]/g, '-')}.zip`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}