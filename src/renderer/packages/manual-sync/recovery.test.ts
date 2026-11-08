import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('i18next')>()
  return { ...actual, default: actual.createInstance() }
})
import i18n from 'i18next'
import { readSyncRecovery, saveSyncRecovery } from './recovery'

beforeEach(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {}, keySeparator: false, interpolation: { escapeValue: false } })
})
afterEach(() => vi.unstubAllGlobals())

function storage() {
  const open: Partial<IDBOpenDBRequest> = {}
  const tx: Partial<IDBTransaction> = {}
  const request: Partial<IDBRequest> = {}
  let value: unknown
  const put = vi.fn((next: unknown) => { value = next; queueMicrotask(() => tx.oncomplete?.call(tx as IDBTransaction, {} as Event)) })
  const get = vi.fn(() => {
    Object.assign(request, { result: value })
    queueMicrotask(() => request.onsuccess?.call(request as IDBRequest, {} as Event))
    return request
  })
  const close = vi.fn()
  tx.objectStore = vi.fn(() => ({ put, get }) as unknown as IDBObjectStore)
  const db = { transaction: vi.fn(() => tx), close }
  vi.stubGlobal('indexedDB', {
    open: vi.fn(() => {
      Object.assign(open, { result: db })
      queueMicrotask(() => open.onsuccess?.call(open as IDBOpenDBRequest, {} as Event))
      return open
    }),
  })
  return { open, tx, put, get, close }
}

it('persists the latest recovery archive separately and closes every connection', async () => {
  const store = storage()
  expect(await readSyncRecovery()).toBeNull()
  const zip = new Uint8Array([1, 2, 3])
  await saveSyncRecovery(zip)
  expect(await readSyncRecovery()).toEqual({ createdAt: expect.any(String), zip })
  expect(store.put).toHaveBeenCalledWith({ createdAt: expect.any(String), zip }, 'latest')
  expect(store.close).toHaveBeenCalledTimes(3)
})

it('refuses empty recovery archives before opening storage', async () => {
  storage()
  await expect(saveSyncRecovery(new Uint8Array())).rejects.toThrow('Invalid recovery backup size.')
  expect(indexedDB.open).not.toHaveBeenCalled()
})

it.each([
  ['onerror', 'Cannot open recovery backup storage. Local data was not replaced.'],
  ['onblocked', 'Recovery backup storage is blocked. Close other client windows.'],
] as const)('reports %s in English', async (event, message) => {
  const open: Partial<IDBOpenDBRequest> = {}
  vi.stubGlobal('indexedDB', { open: () => {
    queueMicrotask(() => open[event]?.call(open as IDBOpenDBRequest, {} as Event))
    return open
  } })
  await expect(readSyncRecovery()).rejects.toThrow(message)
})

it('reports a failed durable write and closes storage', async () => {
  const store = storage()
  store.put.mockImplementation(() => { queueMicrotask(() => store.tx.onabort?.call(store.tx as IDBTransaction, {} as Event)) })
  await expect(saveSyncRecovery(new Uint8Array([1]))).rejects.toThrow('Cannot persist the recovery backup (storage may be full). Local data was not replaced.')
  expect(store.close).toHaveBeenCalledOnce()
})