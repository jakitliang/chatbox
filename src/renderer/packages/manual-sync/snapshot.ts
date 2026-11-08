import i18n, { type TOptions } from 'i18next'
import { assertSafeArchivePath, createZipStream, readZipFileEntries, type ByteSource } from '@chatbox/core/io'
import initSqlJs, { type Database } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

export const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024
export const FULL_SELECTION = { sessions: true, settings: true, copilots: true, credentials: true } as const
export const SNAPSHOT_GLOBAL_KEYS = [
  'settings', 'myCopilots', 'chat-session-settings', 'picture-session-settings', 'session-folders',
  'agent-soul', 'agent-memories', 'copilot-memories', 'copilot-memory-owners', 'copilot-memory-state-tokens',
] as const
let sqlite: ReturnType<typeof initSqlJs> | undefined
const sql = () => (sqlite ??= initSqlJs({ locateFile: () => wasmUrl }))

/** Resolve the current language at call time. Never import @/i18n during backup bootstrap. */
export function syncT(key: string, options?: TOptions): string {
  return i18n.t(key, { ...options, defaultValue: key, returnEmptyString: false }) || key
}

export function byteSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    readBytes: async (offset, length) => bytes.slice(offset, offset + length),
    async *chunks() {
      for (let offset = 0; offset < bytes.length; offset += 1024 * 1024)
        yield bytes.subarray(offset, offset + 1024 * 1024)
    },
  }
}

/** Both compressed output and uncompressed entry bytes have independent hard limits. */
export async function collectBounded(chunks: AsyncIterable<Uint8Array>, limit = MAX_SNAPSHOT_BYTES): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let size = 0
  for await (const chunk of chunks) {
    size += chunk.length
    if (size > limit) throw new Error(syncT('The snapshot exceeds the size limit. Reduce attachments and try again.'))
    parts.push(chunk.slice())
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return bytes
}

export async function zipToSnapshot(zip: Uint8Array): Promise<Uint8Array> {
  if (zip.length > MAX_SNAPSHOT_BYTES) throw new Error(syncT('The snapshot exceeds the 256 MiB limit.'))
  const SQL = await sql(), db = new SQL.Database()
  try {
    db.run('PRAGMA journal_mode=DELETE; PRAGMA user_version=1; CREATE TABLE archive_entries(path TEXT PRIMARY KEY, data BLOB NOT NULL); CREATE TABLE snapshot_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);')
    const insert = db.prepare('INSERT INTO archive_entries VALUES (?, ?)')
    try {
      await readZipFileEntries(byteSource(zip), ({ path, data }) => { insert.run([path, data]) }, {
        limits: { maxEntries: 65534, maxEntryUncompressedBytes: MAX_SNAPSHOT_BYTES, maxTotalUncompressedBytes: MAX_SNAPSHOT_BYTES },
      })
    } finally { insert.free() }
    const bytes = db.export()
    if (bytes.length > MAX_SNAPSHOT_BYTES) throw new Error(syncT('The SQLite snapshot exceeds the 256 MiB limit.'))
    return bytes
  } finally { db.close() }
}

function checkSchema(db: Database) {
  if (db.exec('PRAGMA user_version')[0]?.values[0]?.[0] !== 1 || db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] !== 'ok')
    throw new Error(syncT('Invalid SQLite version or integrity.'))
  const expected: Record<string, string> = {
    archive_entries: 'pathtextprimarykey,datablobnotnull', snapshot_meta: 'keytextprimarykey,valuetextnotnull',
  }
  const found = new Set<string>()
  for (const [kind, name, table, definition] of db.exec('SELECT type,name,tbl_name,sql FROM sqlite_master')[0]?.values ?? []) {
    if (kind === 'index' && definition === null && name === `sqlite_autoindex_${table}_1` && Object.hasOwn(expected, String(table))) continue
    const normalized = String(definition).replace(/[\s"`\[\]]/g, '').toLowerCase().replace(/;$/, '')
    const base = `createtable${name}(${expected[String(name)]})`
    const notnull = base.replace('textprimarykey', 'textnotnullprimarykey')
    if (kind !== 'table' || table !== name || !Object.hasOwn(expected, String(name)) ||
      ![base, notnull].some((schema) => [schema, `${schema}strict`, `${schema}withoutrowid`].includes(normalized)))
      throw new Error(syncT('The snapshot contains an unknown or unsafe SQLite schema.'))
    found.add(String(name))
  }
  if (found.size !== 2) throw new Error(syncT('The snapshot is missing required tables.'))
  for (const query of [
    "SELECT count(*) FROM archive_entries WHERE typeof(path)!='text' OR typeof(data)!='blob'",
    "SELECT count(*) FROM snapshot_meta WHERE typeof(key)!='text' OR typeof(value)!='text'",
  ]) if (db.exec(query)[0]?.values[0]?.[0] !== 0) throw new Error(syncT('Invalid snapshot row type.'))
}

export async function snapshotToZip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!bytes.length || bytes.length > MAX_SNAPSHOT_BYTES ||
    new TextDecoder().decode(bytes.subarray(0, 16)) !== 'SQLite format 3\0' || bytes[18] !== 1 || bytes[19] !== 1)
    throw new Error(syncT('The backend file is not a supported standalone SQLite snapshot.'))
  const SQL = await sql(), db = new SQL.Database(bytes)
  try {
    checkSchema(db)
    const statement = db.prepare('SELECT path,data FROM archive_entries ORDER BY path')
    async function* entries() {
      let total = 0, count = 0
      try {
        while (statement.step()) {
          const [path, data] = statement.get()
          if (typeof path !== 'string' || !(data instanceof Uint8Array)) throw new Error(syncT('Invalid snapshot row type.'))
          assertSafeArchivePath(path)
          total += data.length
          if (++count > 65534 || total > MAX_SNAPSHOT_BYTES) throw new Error(syncT('Snapshot entries exceed the capacity limit.'))
          yield { path, data }
        }
      } finally { statement.free() }
    }
    return await collectBounded(createZipStream(entries()))
  } finally { db.close() }
}

/** Full restore intentionally rejects partial selections and inconsistent completion statistics. */
export async function readFullSnapshotScope(zip: Uint8Array) {
  const entries = new Map<string, Uint8Array>()
  await readZipFileEntries(byteSource(zip), ({ path, data }) => { entries.set(path, data) }, {
    limits: { maxEntries: 65534, maxEntryUncompressedBytes: MAX_SNAPSHOT_BYTES, maxTotalUncompressedBytes: MAX_SNAPSHOT_BYTES },
  })
  const json = (path: string) => {
    const data = entries.get(path)
    if (!data) throw new Error(syncT('The snapshot is missing {{path}}.', { path }))
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
    } catch {
      throw new Error(syncT('Cannot read snapshot JSON from {{path}}.', { path }))
    }
  }
  const manifest = json('manifest.json'), complete = json('complete.json')
  if (manifest.format !== 'chatbox-backup' || manifest.formatVersion !== 3 || manifest.layout !== 'rows' ||
    Object.entries(FULL_SELECTION).some(([key, value]) => manifest.selection?.[key] !== value) || complete.archiveId !== manifest.archiveId)
    throw new Error(syncT('Replacement restore requires a complete V3 snapshot with conversations, settings, assistants and credentials.'))
  json('settings.json'); json('copilots.json')
  if (!entries.has('resources.jsonl')) throw new Error(syncT('The snapshot is missing its resource index.'))
  const sessionIds = new Set<string>()
  const counts = { session: 0, thread: 0, message: 0, global: 0, resource: 0, warning: 0 }
  let resourceBytes = 0, dataBytes = 0, uncompressedBytes = 0
  for (const [path, data] of entries) {
    if (path === 'complete.json') continue
    uncompressedBytes += data.length
    if (path.startsWith('resources/')) { resourceBytes += data.length; continue }
    if (path === 'manifest.json') continue
    dataBytes += data.length
    if (path.endsWith('.jsonl')) {
      for (const line of new TextDecoder('utf-8', { fatal: true }).decode(data).split('\n')) {
        if (!line.trim()) continue
        const row = JSON.parse(line)
        if (!Object.hasOwn(counts, row.type) || row.type === 'global') throw new Error(syncT('Invalid snapshot row type.'))
        counts[row.type as keyof typeof counts]++
        if (row.type === 'session') sessionIds.add(row.session.id)
      }
    }
  }
  counts.global = 1 + json('copilots.json').length
  const shared = entries.has('session-settings.json') ? json('session-settings.json') : {}
  for (const [key, value] of Object.entries(shared)) {
    counts.global += ['chat-session-settings', 'picture-session-settings', 'agent-soul'].includes(key) ? 1 :
      key === 'copilot-memories' ? Object.keys(value as object).length : (value as unknown[]).length
  }
  const stats = { resourceBytes, dataBytes, uncompressedBytes, entryCount: entries.size }
  for (const [key, value] of Object.entries(stats)) if (complete[key] !== undefined && complete[key] !== value) throw new Error(syncT('Snapshot completion statistics do not match.'))
  if (complete.counts && Object.entries(counts).some(([key, value]) => complete.counts[key] !== value)) throw new Error(syncT('Snapshot record counts do not match.'))
  return { sessionIds, sharedKeys: Object.keys(shared) }
}