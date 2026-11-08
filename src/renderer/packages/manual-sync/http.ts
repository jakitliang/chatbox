import { normalizeAppApiServer } from '@shared/request/chatbox-api-origin'
import { collectBounded, MAX_SNAPSHOT_BYTES, syncT as t } from './snapshot'

export const CHUNK_BYTES = 1024 * 1024
const HASH = /^[a-f0-9]{64}$/
export type SyncProgress = (message: string, percent?: number) => void
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
export function requireSyncAddress(address: string): string {
  const origin = normalizeAppApiServer(address)
  if (!origin) throw new Error(t('Enter and save the sync backend address first.'))
  return origin
}
const statusMessages: Record<number, string> = {
  400: 'The backend rejected the snapshot or checksum. Check the format and back up again.',
  401: 'Incorrect username or password, or login expired. Enter your credentials again.',
  403: 'The backend rejected the origin or transport. Check HTTPS, Host and the CORS allowlist.',
  404: 'No backend snapshot is available, or the upload expired. Back up to the backend first.',
  409: 'The backend snapshot changed. Download it again.', 413: 'The snapshot exceeds the backend size limit.',
  429: 'Too many requests. Wait five minutes; staged uploads may take an hour to expire.',
}

/** Constructor is inert; only explicit upload/download actions perform requests. Tokens never persist. */
export class ManualSyncClient {
  private readonly origin: string
  constructor(address: string, private readonly request: typeof fetch = (...args) => globalThis.fetch(...args)) { this.origin = requireSyncAddress(address) }
  private async call(path: string, token?: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    let response: Response
    try {
      response = await this.request(`${this.origin}/api/sync/${path}`, {
        ...init, headers, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60_000),
      })
    } catch (error) {
      const stage = path === 'login' ? t('Signing in') : path === 'logout' ? t('Signing out') :
        path.includes('/chunks/') ? t('Transferring chunks') : t('Syncing snapshot')
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      // Do not log RequestInit: it contains passwords or bearer credentials.
      throw new Error(t('Cannot connect to the sync backend ({{stage}}, {{origin}}): {{reason}}. Check the address and port, network, TLS certificate and CORS configuration.', { stage, origin: this.origin, reason }))
    }
    if (!response.ok) throw new Error(statusMessages[response.status]
      ? t(statusMessages[response.status])
      : t('Backend request failed ({{status}}). Please try again later.', { status: response.status }))
    return response
  }
  private async login(username: string, password: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(username) || password.length < 12 || password.length > 1024)
      throw new Error(t('Enter a registered username (letters, digits, _ or -) and a password of 12–1024 characters.'))
    const response = await this.call('login', undefined, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
    })
    const { token } = await response.json()
    if (typeof token !== 'string' || !token || token.length > 4096 || /[\r\n]/.test(token)) throw new Error(t('Invalid backend login response.'))
    return token
  }
  private async session<T>(username: string, password: string, action: (token: string) => Promise<T>) {
    const token = await this.login(username, password)
    try { return await action(token) }
    finally { await this.call('logout', token, { method: 'POST' }).catch(() => {}) }
  }
  async upload(bytes: Uint8Array, username: string, password: string, progress: SyncProgress) {
    if (!bytes.length || bytes.length > MAX_SNAPSHOT_BYTES) throw new Error(t('Invalid snapshot size or size exceeds 256 MiB.'))
    progress(t('Calculating the whole-file checksum'), 0)
    const digest = await sha256(bytes)
    return this.session(username, password, async (token) => {
      const response = await this.call('uploads', token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ size: bytes.length, sha256: digest }),
      })
      const { id } = await response.json()
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new Error(t('Invalid backend upload ID.'))
      for (let offset = 0, index = 0; offset < bytes.length; offset += CHUNK_BYTES, index++) {
        const chunk = bytes.slice(offset, offset + CHUNK_BYTES)
        await this.call(`uploads/${id}/chunks/${index}`, token, {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Chunk-SHA256': await sha256(chunk) }, body: chunk,
        })
        progress(t('Uploading snapshot'), Math.round(Math.min(offset + CHUNK_BYTES, bytes.length) / bytes.length * 100))
      }
      progress(t('Backend validating and committing snapshot'), 100)
      await this.call(`uploads/${id}/commit`, token, { method: 'POST' })
    })
  }
  async download(username: string, password: string, progress: SyncProgress): Promise<Uint8Array> {
    return this.session(username, password, async (token) => {
      const metadata = await (await this.call('snapshot', token)).json()
      if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > MAX_SNAPSHOT_BYTES ||
        !HASH.test(metadata.sha256) || metadata.chunks !== Math.ceil(metadata.size / CHUNK_BYTES)) throw new Error(t('Invalid backend snapshot metadata.'))
      const bytes = new Uint8Array(metadata.size)
      for (let index = 0; index < metadata.chunks; index++) {
        const response = await this.call(`snapshot/chunks/${index}`, token, { headers: { 'X-Snapshot-SHA256': metadata.sha256 } })
        const expected = Math.min(CHUNK_BYTES, metadata.size - index * CHUNK_BYTES)
        const reader = response.body?.getReader()
        if (!reader) throw new Error(t('The backend snapshot chunk is empty.'))
        async function* chunks() {
          try { while (true) { const item = await reader!.read(); if (item.done) return; yield item.value } }
          finally { await reader!.cancel().catch(() => {}); reader!.releaseLock() }
        }
        const chunk = await collectBounded(chunks(), expected)
        if (chunk.length !== expected || response.headers.get('X-Snapshot-SHA256') !== metadata.sha256 ||
          response.headers.get('X-Chunk-SHA256') !== await sha256(chunk)) throw new Error(t('Snapshot chunk verification failed. Local data is unchanged. Download again.'))
        bytes.set(chunk, index * CHUNK_BYTES)
        progress(t('Downloading and verifying snapshot'), Math.round((index + 1) / metadata.chunks * 100))
      }
      if (await sha256(bytes) !== metadata.sha256) throw new Error(t('Whole-file snapshot verification failed. Local data is unchanged. Download again.'))
      return bytes
    })
  }
}