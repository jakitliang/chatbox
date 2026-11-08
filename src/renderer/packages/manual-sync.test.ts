import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('i18next')>()
  return { ...actual, default: actual.createInstance() }
})
import i18n from 'i18next'

const mocks = vi.hoisted(() => ({
  isActive: vi.fn(), exportBytes: vi.fn(), validateSyncBackup: vi.fn(), replaceSyncBackup: vi.fn(),
  download: vi.fn(), upload: vi.fn(), save: vi.fn(), read: vi.fn(), scope: vi.fn(), zip: vi.fn(), sqlite: vi.fn(),
}))
vi.mock('@/app/renderer-backup', () => ({ rendererBackupService: mocks }))
vi.mock('./manual-sync/http', () => ({
  requireSyncAddress: vi.fn(),
  ManualSyncClient: class { download = mocks.download; upload = mocks.upload },
}))
vi.mock('./manual-sync/recovery', () => ({ readSyncRecovery: mocks.read, saveSyncRecovery: mocks.save }))
vi.mock('./manual-sync/snapshot', async (importOriginal) => ({
  ...await importOriginal<typeof import('./manual-sync/snapshot')>(),
  readFullSnapshotScope: mocks.scope, snapshotToZip: mocks.zip, zipToSnapshot: mocks.sqlite,
}))
import { restoreManualSync, restoreManualSyncRecovery, uploadManualSync } from './manual-sync'

const zip = new Uint8Array([1]), sqlite = new Uint8Array([2])
const scope = { sessionIds: new Set(['conversation']), sharedKeys: ['agent-soul'] }
beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {}, keySeparator: false, interpolation: { escapeValue: false } })
  mocks.exportBytes.mockResolvedValue({ bytes: zip })
  mocks.download.mockResolvedValue(sqlite)
  mocks.zip.mockResolvedValue(zip)
  mocks.sqlite.mockResolvedValue(sqlite)
  mocks.scope.mockResolvedValue(scope)
})

it('reports English upload progress and only uploads a validated complete archive', async () => {
  const progress = vi.fn()
  await uploadManualSync('localhost', 'alice', 'password', progress)
  expect(progress.mock.calls).toEqual([
    ['Creating a complete local V3 backup', 0], ['Packaging a standalone SQLite snapshot', 0],
  ])
  expect(mocks.scope).toHaveBeenCalledWith(zip)
  expect(mocks.upload).toHaveBeenCalledWith(sqlite, 'alice', 'password', progress)
})

it('validates and durably saves recovery before replacing local data', async () => {
  const progress = vi.fn()
  await restoreManualSync('localhost', 'alice', 'password', progress)
  expect(mocks.validateSyncBackup.mock.invocationCallOrder[0]).toBeLessThan(mocks.exportBytes.mock.invocationCallOrder[0])
  expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.replaceSyncBackup.mock.invocationCallOrder[0])
  expect(mocks.replaceSyncBackup).toHaveBeenCalledWith(zip, scope.sessionIds, scope.sharedKeys)
  expect(progress).toHaveBeenLastCalledWith('Replacement restore complete', 100)
})

it('never replaces data if durable recovery storage fails and releases the operation lock', async () => {
  mocks.save.mockRejectedValueOnce(new Error('storage full'))
  await expect(restoreManualSync('localhost', 'alice', 'password', vi.fn())).rejects.toThrow('storage full')
  expect(mocks.replaceSyncBackup).not.toHaveBeenCalled()
  await restoreManualSync('localhost', 'alice', 'password', vi.fn())
  expect(mocks.replaceSyncBackup).toHaveBeenCalledOnce()
})

it('restores local recovery without contacting the server', async () => {
  mocks.read.mockResolvedValue({ createdAt: '2026-11-09', zip })
  const progress = vi.fn()
  await restoreManualSyncRecovery(progress)
  expect(mocks.download).not.toHaveBeenCalled()
  expect(mocks.save).not.toHaveBeenCalled()
  expect(progress).toHaveBeenLastCalledWith('Local recovery complete', 100)
})

it('reports missing recovery and concurrent backups in English', async () => {
  mocks.read.mockResolvedValue(null)
  await expect(restoreManualSyncRecovery(vi.fn())).rejects.toThrow('No local pre-replacement recovery backup is available.')
  mocks.isActive.mockReturnValue(true)
  await expect(uploadManualSync('localhost', 'alice', 'password', vi.fn())).rejects.toThrow('A backup or sync is in progress. Please wait.')
  expect(mocks.exportBytes).not.toHaveBeenCalled()
})

it('uses the current language for progress and errors without reimporting sync', async () => {
  i18n.addResourceBundle('fr', 'translation', {
    'Creating a complete local V3 backup': 'Création d’une sauvegarde locale V3 complète',
    'No local pre-replacement recovery backup is available.': 'Aucune sauvegarde locale de récupération avant remplacement n’est disponible.',
  })
  const progress = vi.fn()
  await uploadManualSync('localhost', 'alice', 'password', progress)
  expect(progress).toHaveBeenNthCalledWith(1, 'Creating a complete local V3 backup', 0)
  await i18n.changeLanguage('fr')
  await uploadManualSync('localhost', 'alice', 'password', progress)
  expect(progress).toHaveBeenNthCalledWith(3, 'Création d’une sauvegarde locale V3 complète', 0)
  expect(progress).toHaveBeenLastCalledWith('Packaging a standalone SQLite snapshot', 0)
  mocks.read.mockResolvedValue(null)
  await expect(restoreManualSyncRecovery(progress)).rejects.toThrow('Aucune sauvegarde locale de récupération avant remplacement n’est disponible.')
})