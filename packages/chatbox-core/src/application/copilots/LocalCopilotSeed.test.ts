import { describe, expect, it, vi } from 'vitest'
import { InMemoryKeyValueStorage } from '../../testing/InMemoryKeyValueStorage'
import { CopilotService, isCopilotDetail, MY_COPILOTS_STORAGE_KEY, searchCopilots } from './CopilotService'
import {
  filterCopilotsByCategory,
  getCopilotCategories,
  initializeLocalCopilots,
  LOCAL_COPILOTS_INITIALIZED_STORAGE_KEY,
} from './LocalCopilotSeed'

const seed = [{ id: 'bundled', name: 'Tutor', prompt: 'Help', category: 'Study' }]

describe('local copilot initialization', () => {
  it('persists once, survives restart and does not resurrect removed definitions', async () => {
    const storage = new InMemoryKeyValueStorage()
    const load = vi.fn(async () => seed)
    expect(await initializeLocalCopilots(storage, load)).toEqual(seed)
    expect(await storage.get(LOCAL_COPILOTS_INITIALIZED_STORAGE_KEY)).toBe(true)
    expect(await initializeLocalCopilots(storage, load)).toEqual(seed)
    await storage.set(MY_COPILOTS_STORAGE_KEY, [])
    expect(await initializeLocalCopilots(storage, load)).toEqual([])
    await storage.remove(MY_COPILOTS_STORAGE_KEY)
    expect(await initializeLocalCopilots(storage, load)).toEqual([])
    expect(load).toHaveBeenCalledOnce()
  })

  it.each([{ existing: [] }, { existing: [{ id: 'user', name: 'My assistant', prompt: 'Mine', category: 'Custom' }] }])(
    'preserves existing and restored collections: %j', async ({ existing }) => {
      const storage = new InMemoryKeyValueStorage()
      await storage.set(MY_COPILOTS_STORAGE_KEY, existing)
      const load = vi.fn(async () => seed)
      expect(await initializeLocalCopilots(storage, load)).toEqual(existing)
      expect(await storage.get(MY_COPILOTS_STORAGE_KEY)).toEqual(existing)
      expect(load).not.toHaveBeenCalled()
      expect(await storage.get(LOCAL_COPILOTS_INITIALIZED_STORAGE_KEY)).toBe(true)
    }
  )

  it('leaves malformed existing data untouched and retries failed reads/assets', async () => {
    const storage = new InMemoryKeyValueStorage()
    const malformed = [{ ...seed[0], category: 42 }]
    await storage.set(MY_COPILOTS_STORAGE_KEY, malformed)
    const load = vi.fn(async () => seed)
    await expect(initializeLocalCopilots(storage, load)).rejects.toThrow('Invalid saved')
    expect(await storage.get(MY_COPILOTS_STORAGE_KEY)).toEqual(malformed)
    expect(load).not.toHaveBeenCalled()
    await storage.remove(MY_COPILOTS_STORAGE_KEY)
    vi.spyOn(storage, 'get').mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(initializeLocalCopilots(storage, load)).rejects.toThrow('disk unavailable')
    load.mockRejectedValueOnce(new Error('asset failed'))
    await expect(initializeLocalCopilots(storage, load)).rejects.toThrow('asset failed')
    expect(await storage.get(LOCAL_COPILOTS_INITIALIZED_STORAGE_KEY)).toBeNull()
    expect(await initializeLocalCopilots(storage, load)).toEqual(seed)
  })

  it('does not duplicate seeds after interrupted marker persistence', async () => {
    const storage = new InMemoryKeyValueStorage()
    const original = storage.set.bind(storage)
    vi.spyOn(storage, 'set').mockImplementationOnce(original).mockRejectedValueOnce(new Error('marker failed'))
    const load = vi.fn(async () => seed)
    await expect(initializeLocalCopilots(storage, load)).rejects.toThrow('marker failed')
    expect(await initializeLocalCopilots(storage, load)).toEqual(seed)
    expect(load).toHaveBeenCalledOnce()
  })

  it('trims, persists and searches optional categories while accepting older definitions', async () => {
    const storage = new InMemoryKeyValueStorage()
    const service = new CopilotService({ storage })
    await service.upsert({ ...seed[0], category: ' Study ' })
    const restarted = new CopilotService({ storage })
    await restarted.hydrate()
    expect(restarted.getSnapshot().copilots[0].category).toBe('Study')
    expect(searchCopilots(restarted.getSnapshot().copilots, 'study')).toHaveLength(1)
    expect(isCopilotDetail({ id: 'old', name: 'Old', prompt: 'Help' })).toBe(true)
    expect(isCopilotDetail({ ...seed[0], category: 42 })).toBe(false)
    const records = [...seed, { id: 'old', name: 'Old', prompt: 'Help' }]
    expect(getCopilotCategories(records)).toEqual(['Study'])
    expect(filterCopilotsByCategory(records, 'Study')).toEqual(seed)
    expect(filterCopilotsByCategory(records, '')).toEqual([records[1]])
    expect(filterCopilotsByCategory(records)).toEqual(records)
  })
})