import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('i18next')>()
  return { ...actual, default: actual.createInstance() }
})
import i18n from 'i18next'
import { createZipStream, readZipFileEntries } from '@chatbox/core/io'
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: path.resolve('node_modules/sql.js/dist/sql-wasm.wasm') }))
import { byteSource, collectBounded, FULL_SELECTION, readFullSnapshotScope, snapshotToZip, syncT, zipToSnapshot } from './snapshot'

beforeEach(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {}, keySeparator: false, interpolation: { escapeValue: false } })
})

async function fixture() {
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
  const entries = [
    { path: 'manifest.json', data: encode({ format: 'chatbox-backup', formatVersion: 3, layout: 'rows', archiveId: 'test', createdAt: '2026-11-09T00:00:00.000Z', producer: 'test', selection: FULL_SELECTION }) },
    { path: 'complete.json', data: encode({ archiveId: 'test' }) },
    { path: 'resources.jsonl', data: new Uint8Array() },
    { path: 'settings.json', data: encode({ language: 'en' }) },
    { path: 'copilots.json', data: encode([{ id: 'a', name: 'Assistant', prompt: 'local', category: 'Work' }]) },
  ]
  return { zip: await collectBounded(createZipStream(entries)), entries }
}

it('roundtrips every portable V3 entry byte-for-byte through a standalone SQLite file', async () => {
  const { zip, entries } = await fixture()
  const database = await zipToSnapshot(zip)
  expect(new TextDecoder().decode(database.subarray(0, 16))).toBe('SQLite format 3\0')
  const directory = mkdtempSync(path.join(tmpdir(), 'chatbox-snapshot-contract-'))
  try {
    const file = path.join(directory, 'snapshot.db')
    writeFileSync(file, database)
    execFileSync('python3', ['-c', 'from pathlib import Path; from server.snapshot_validation import validate_snapshot; import sys; validate_snapshot(Path(sys.argv[1]))', file])
  } finally { rmSync(directory, { recursive: true, force: true }) }
  const output = await snapshotToZip(database)
  const actual = new Map<string, Uint8Array>()
  await readZipFileEntries(byteSource(output), ({ path, data }) => { actual.set(path, data) })
  for (const entry of entries) expect(actual.get(entry.path)).toEqual(entry.data)
  expect((await readFullSnapshotScope(output)).sessionIds.size).toBe(0)
})

it('rejects invalid SQLite and bounded streams', async () => {
  await expect(snapshotToZip(new Uint8Array([1, 2]))).rejects.toThrow('SQLite')
  async function* chunks() { yield new Uint8Array(3); yield new Uint8Array(3) }
  await expect(collectBounded(chunks(), 5)).rejects.toThrow('The snapshot exceeds the size limit. Reduce attachments and try again.')
})

it('uses English defaults and interpolates paths when a translation is absent', async () => {
  expect(syncT('The snapshot is missing {{path}}.', { path: 'manifest.json' })).toBe('The snapshot is missing manifest.json.')
  const zip = await collectBounded(createZipStream([]))
  await expect(readFullSnapshotScope(zip)).rejects.toThrow('The snapshot is missing manifest.json.')
})

it('translates snapshot errors using the controlled instance', async () => {
  i18n.addResourceBundle('fr', 'translation', { 'The snapshot is missing {{path}}.': 'Il manque {{path}} dans l’instantané.' })
  await i18n.changeLanguage('fr')
  expect(syncT('The snapshot is missing {{path}}.', { path: 'settings.json' })).toBe('Il manque settings.json dans l’instantané.')
  expect(syncT('Invalid snapshot row type.')).toBe('Invalid snapshot row type.')
})

it('keeps the English default when a locale contains an empty translation', () => {
  i18n.addResourceBundle('en', 'translation', { 'Invalid snapshot row type.': '' })
  expect(syncT('Invalid snapshot row type.')).toBe('Invalid snapshot row type.')
})