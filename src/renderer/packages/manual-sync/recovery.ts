import { MAX_SNAPSHOT_BYTES, syncT as t } from './snapshot'

export interface SyncRecovery { createdAt: string; zip: Uint8Array }
/** Separate durable database: startup cleanup of ordinary backup workspaces must not erase recovery. */
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('chatbox-manual-sync-recovery', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('recovery')
    open.onerror = () => reject(new Error(t('Cannot open recovery backup storage. Local data was not replaced.')))
    open.onblocked = () => reject(new Error(t('Recovery backup storage is blocked. Close other client windows.')))
    open.onsuccess = () => resolve(open.result)
  })
}
export async function saveSyncRecovery(zip: Uint8Array): Promise<void> {
  if (!zip.length || zip.length > MAX_SNAPSHOT_BYTES) throw new Error(t('Invalid recovery backup size.'))
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('recovery', 'readwrite')
      tx.objectStore('recovery').put({ createdAt: new Date().toISOString(), zip }, 'latest')
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () => reject(new Error(t('Cannot persist the recovery backup (storage may be full). Local data was not replaced.')))
    })
  } finally { db.close() }
}
export async function readSyncRecovery(): Promise<SyncRecovery | null> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('recovery').objectStore('recovery').get('latest')
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => reject(new Error(t('Cannot read the local recovery backup.')))
    })
  } finally { db.close() }
}