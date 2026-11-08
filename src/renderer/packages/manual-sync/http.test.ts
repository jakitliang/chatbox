import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('i18next')>()
  return { ...actual, default: actual.createInstance() }
})
import i18n from 'i18next'
import { CHUNK_BYTES, ManualSyncClient, sha256 } from './http'

beforeEach(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {}, keySeparator: false, interpolation: { escapeValue: false } })
})
afterEach(() => vi.unstubAllGlobals())
const password = 'test-only-password'
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })

it('is inert with a configured server and refuses missing configuration or insecure remote transport', () => {
  const request = vi.fn()
  new ManualSyncClient('127.0.0.1:4567', request)
  expect(request).not.toHaveBeenCalled()
  expect(() => new ManualSyncClient('', request)).toThrow('Enter and save the sync backend address first.')
  expect(() => new ManualSyncClient('http://remote.example', request)).toThrow('HTTPS')
  expect(request).not.toHaveBeenCalled()
})

it('calls browser fetch with its global receiver rather than the sync client', async () => {
  vi.stubGlobal('fetch', vi.fn(function (this: unknown) {
    expect(this).toBe(globalThis)
    return Promise.resolve(new Response(null, { status: 401 }))
  }))
  await expect(new ManualSyncClient('http://localhost:4567').download('admin', password, vi.fn())).rejects.toThrow('Incorrect username or password')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('uploads bounded chunks with their hashes, commits, and revokes the ephemeral token', async () => {
  const bytes = new Uint8Array(CHUNK_BYTES + 12).fill(7)
  const id = 'a'.repeat(32)
  const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url)
    if (path.endsWith('/login')) return json({ token: 'ephemeral' })
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ephemeral')
    expect(init?.credentials).toBe('omit')
    expect(init?.redirect).toBe('error')
    if (path.endsWith('/uploads')) {
      expect(JSON.parse(String(init?.body))).toEqual({ size: bytes.length, sha256: await sha256(bytes) })
      return json({ id })
    }
    if (path.includes('/chunks/')) {
      const chunk = init?.body as Uint8Array
      expect(chunk.length).toBe(path.endsWith('/0') ? CHUNK_BYTES : 12)
      expect(new Headers(init?.headers).get('X-Chunk-SHA256')).toBe(await sha256(chunk))
    }
    return new Response(null, { status: 204 })
  })
  await new ManualSyncClient('http://localhost:4567', request).upload(bytes, 'alice', password, vi.fn())
  expect(request.mock.calls.map(([url]) => String(url).split('/api/sync/')[1])).toEqual([
    'login', 'uploads', `uploads/${id}/chunks/0`, `uploads/${id}/chunks/1`, `uploads/${id}/commit`, 'logout',
  ])
})

it('pins download revision and rejects corrupt bytes before returning any data', async () => {
  const bytes = new Uint8Array([1, 2, 3])
  const digest = await sha256(bytes)
  const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url)
    if (path.endsWith('/login')) return json({ token: 'ephemeral' })
    if (path.endsWith('/snapshot')) return json({ size: bytes.length, sha256: digest, chunks: 1 })
    if (path.includes('/chunks/')) {
      expect(new Headers(init?.headers).get('X-Snapshot-SHA256')).toBe(digest)
      return new Response(new Uint8Array([1, 2, 9]), { headers: { 'X-Chunk-SHA256': digest, 'X-Snapshot-SHA256': digest } })
    }
    return new Response(null, { status: 204 })
  })
  await expect(new ManualSyncClient('http://localhost:4567', request).download('alice', password, vi.fn())).rejects.toThrow('Snapshot chunk verification failed.')
  expect(String(request.mock.calls.at(-1)?.[0])).toContain('/logout')
})

it('reports connection and authentication failures without saving credentials', async () => {
  const offline = vi.fn().mockRejectedValue(new Error('offline'))
  await expect(new ManualSyncClient('http://localhost:4567', offline).download('alice', password, vi.fn())).rejects.toThrow('Cannot connect to the sync backend (Signing in, http://localhost:4567): Error: offline.')
  const denied = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
  await expect(new ManualSyncClient('http://localhost:4567', denied).download('alice', password, vi.fn())).rejects.toThrow('Incorrect username or password')
})

it('resolves HTTP status and interpolated network errors after a language change', async () => {
  const key = 'Cannot connect to the sync backend ({{stage}}, {{origin}}): {{reason}}. Check the address and port, network, TLS certificate and CORS configuration.'
  i18n.addResourceBundle('fr', 'translation', {
    'Signing in': 'Connexion',
    [key]: 'Connexion impossible ({{stage}}, {{origin}}) : {{reason}}.',
    'Incorrect username or password, or login expired. Enter your credentials again.': 'Identifiants incorrects ou session expirée.',
    'Backend request failed ({{status}}). Please try again later.': 'Échec de la requête ({{status}}). Réessayez plus tard.',
  })
  const request = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
  const client = new ManualSyncClient('http://localhost:4567', request)
  await expect(client.download('alice', password, vi.fn())).rejects.toThrow('Incorrect username or password')
  await i18n.changeLanguage('fr')
  await expect(client.download('alice', password, vi.fn())).rejects.toThrow('Identifiants incorrects ou session expirée.')
  request.mockResolvedValueOnce(new Response(null, { status: 503 }))
  await expect(client.download('alice', password, vi.fn())).rejects.toThrow('Échec de la requête (503). Réessayez plus tard.')
  request.mockRejectedValueOnce(new Error('offline'))
  await expect(client.download('alice', password, vi.fn())).rejects.toThrow('Connexion impossible (Connexion, http://localhost:4567) : Error: offline.')
})