import { beforeEach, describe, expect, it, vi } from 'vitest'

const { values, blobs, loadSeed, write } = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  blobs: new Map<string, string>(),
  loadSeed: vi.fn(),
  write: vi.fn(),
}))
vi.mock('@/storage', () => ({
  default: {
    getItemRaw: async (key: string) => values.get(key) ?? null,
    getItem: async (key: string, initial: unknown) => values.get(key) ?? initial,
    setItemNow: write,
    removeItem: async (key: string) => { values.delete(key) },
  },
}))
vi.mock('@/catalog/bundled-copilots', () => ({ loadBundledCopilotSeed: loadSeed }))
vi.mock('@/platform', () => ({ default: { getLocale: async () => 'zh-Hans' } }))
vi.mock('@/adapters/CurrentBlobStorage', () => ({
  currentBlobStorage: { set: async (key: string, data: string) => { blobs.set(key, data) } },
}))

const seeded = {
  id: 'seeded', name: 'Local tutor', prompt: 'Help', category: 'Study',
  avatar: { type: 'storage-key', storageKey: 'picture:bundled-copilot:test' },
}

beforeEach(() => {
  vi.resetModules()
  values.clear()
  blobs.clear()
  loadSeed.mockReset().mockReturnValue({
    copilots: [seeded],
    avatars: [{ storageKey: 'picture:bundled-copilot:test', data: 'data:image/png;base64,dGVzdA==' }],
  })
  write.mockReset().mockImplementation(async (key: string, value: unknown) => {
    if (key === 'myCopilots') expect(blobs.has('picture:bundled-copilot:test')).toBe(true)
    values.set(key, structuredClone(value))
  })
})

describe('renderer local copilot initialization', () => {
  it('hydrates assets before definitions, serializes initial edits and survives restart/deletion', async () => {
    let runtime = await import('./memoryRuntime')
    await Promise.all([
      runtime.addOrUpdateMyCopilot({ id: 'user', name: 'Mine', prompt: 'Custom', category: ' Work ' }),
      runtime.addOrUpdateMyCopilot({ id: 'second', name: 'Second', prompt: 'Custom' }),
    ])
    expect(values.get('myCopilots')).toEqual([
      expect.objectContaining({ id: 'second' }),
      expect.objectContaining({ id: 'user', category: 'Work' }),
      seeded,
    ])
    expect(values.get('local-copilots-initialized')).toBe(true)
    expect(loadSeed).toHaveBeenCalledWith(expect.any(Number), 'zh-Hans')
    vi.resetModules()
    runtime = await import('./memoryRuntime')
    expect(await runtime.getCopilotName('seeded')).toBe('Local tutor')
    await runtime.removeMyCopilot('seeded')
    vi.resetModules()
    runtime = await import('./memoryRuntime')
    expect(await runtime.getCopilotName('seeded')).toBeUndefined()
    expect(loadSeed).toHaveBeenCalledOnce()
  })

  it.each([{ records: [] }, { records: [{ id: 'user', name: 'Mine', prompt: 'Custom' }] }])(
    'never seeds over existing or restored user data: %j', async ({ records }) => {
      values.set('myCopilots', records)
      const runtime = await import('./memoryRuntime')
      await runtime.reloadCopilotDefinitions()
      expect(values.get('myCopilots')).toEqual(records)
      expect(loadSeed).not.toHaveBeenCalled()
      expect(blobs.size).toBe(0)
    }
  )

  it('failed loading is retryable and cannot save over unread data', async () => {
    loadSeed.mockImplementation(() => { throw new Error('missing asset') })
    const runtime = await import('./memoryRuntime')
    await expect(runtime.addOrUpdateMyCopilot({ id: 'user', name: 'Mine', prompt: 'Custom' }))
      .rejects.toThrow('missing asset')
    expect(values.has('myCopilots')).toBe(false)
    expect(values.has('local-copilots-initialized')).toBe(false)
    loadSeed.mockReset().mockReturnValue({ copilots: [], avatars: [] })
    // Empty catalogs still produce a durable initialized list.
    write.mockImplementation(async (key: string, value: unknown) => { values.set(key, value) })
    await runtime.reloadCopilotDefinitions()
    expect(values.get('myCopilots')).toEqual([])
    expect(values.get('local-copilots-initialized')).toBe(true)
  })
})