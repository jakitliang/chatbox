import type { BackupHostOptions } from '@chatbox/core/backup-host'
import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('i18next')>()
  return { ...actual, default: actual.createInstance() }
})
import i18n from 'i18next'
const mocks = vi.hoisted(() => ({
  imported: vi.fn(), target: vi.fn(), stream: vi.fn(), source: vi.fn(), generated: vi.fn(), deleted: vi.fn(),
}))
vi.mock('@chatbox/core/backup-import', () => ({ importBackup: mocks.imported }))
vi.mock('@chatbox/core/backup-export', () => ({ exportBackupStream: mocks.stream }))
vi.mock('@chatbox/core/backup-host', () => ({
  createBackupExportSource: mocks.source, createBackupImportTarget: mocks.target,
  cleanupBackupImport: vi.fn(), commitBackupSettings: vi.fn(),
}))
vi.mock('@/adapters/CurrentSessionRecordStore', () => ({ CurrentSessionRecordStore: class {} }))
vi.mock('@/adapters/backup-resources', () => ({ createRendererBackupResources: vi.fn() }))
vi.mock('@/platform', () => ({ default: {} }))
vi.mock('@/storage/BackupWorkspace', () => ({ IndexedDBBackupWorkspace: class {} }))
vi.mock('@/stores/memoryRuntime', () => ({ rendererMemoryService: {}, reloadCopilotDefinitions: vi.fn() }))
vi.mock('./renderer-application', () => ({ rendererApplication: {
  generationRuntime: { getGeneratingSessionIds: mocks.generated }, sessions: { deleteSessions: mocks.deleted },
} }))
import { rendererBackupService } from './renderer-backup'

type Run = (operation: string, action: (options: BackupHostOptions, signal: AbortSignal) => Promise<unknown>) => Promise<unknown>
const service = rendererBackupService as unknown as { run: Run }
let options: BackupHostOptions
beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {}, keySeparator: false, interpolation: { escapeValue: false } })
  mocks.generated.mockReturnValue([])
  mocks.target.mockReturnValue({})
  options = {
    jobId: 'test', workspace: {}, rows: {}, metadata: {},
    storage: { get: vi.fn(), set: vi.fn(), remove: vi.fn(), keys: vi.fn() },
    async *listSessionIds() { yield 'old'; yield 'kept' },
  } as unknown as BackupHostOptions
  vi.spyOn(service, 'run').mockImplementation((_operation, action) => action(options, new AbortController().signal))
})

it('refuses sync export while conversations are generating', async () => {
  mocks.generated.mockReturnValue(['busy'])
  await expect(rendererBackupService.exportBytes()).rejects.toThrow('Stop generation in all conversations first.')
  expect(mocks.stream).not.toHaveBeenCalled()
})

it('refuses incomplete exports before any upload or replacement', async () => {
  mocks.stream.mockImplementation(async function* () {
    yield new Uint8Array([1])
    return { missingResources: true }
  })
  await expect(rendererBackupService.exportBytes()).rejects.toThrow('Complete backup failed due to missing resources. No data was uploaded or replaced.')
})

it('validation uses disposable resources and never deletes local conversations', async () => {
  mocks.imported.mockResolvedValue({ importReport: { importedSessions: 1 } })
  await rendererBackupService.validateSyncBackup(new Uint8Array([1]))
  const target = mocks.imported.mock.calls[0][0].target
  expect(target.createResource).toBeTypeOf('function')
  expect(mocks.deleted).not.toHaveBeenCalled()
  expect(options.storage.remove).not.toHaveBeenCalled()
})

it('refuses unrestorable records with an English recovery instruction', async () => {
  mocks.imported.mockResolvedValue({ importReport: { issueCount: 1 } })
  await expect(rendererBackupService.replaceSyncBackup(new Uint8Array([1]), new Set(['kept']), [])).rejects.toThrow('The snapshot has unrestorable records or missing resources. Replacement refused.')
  expect(mocks.deleted).not.toHaveBeenCalled()
})

it('keeps old conversations on count mismatch and removes only out-of-scope conversations after success', async () => {
  mocks.imported.mockResolvedValueOnce({ importReport: { importedSessions: 0 } })
  await expect(rendererBackupService.replaceSyncBackup(new Uint8Array([1]), new Set(['kept']), [])).rejects.toThrow('Restored conversation counts do not match.')
  expect(mocks.deleted).not.toHaveBeenCalled()
  mocks.imported.mockResolvedValueOnce({ importReport: { importedSessions: 1 } })
  await rendererBackupService.replaceSyncBackup(new Uint8Array([1]), new Set(['kept']), [])
  expect(mocks.deleted).toHaveBeenCalledWith(['old'])
  expect(options.storage.remove).toHaveBeenCalledWith('agent-soul')
  expect(options.storage.remove).not.toHaveBeenCalledWith('settings')
})