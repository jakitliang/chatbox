import { describe, expect, it } from 'vitest'
import { collectGlobalResourceReferences } from '@chatbox/core/resources'
import { loadBundledCopilotSeed } from './bundled-copilots'

describe('bundled assistant resources', () => {
  it.each([['zh-Hans', 36], ['zh-CN', 36], ['zh-Hant', 36], ['en', 41], ['ja', 41]])('seeds only the selected language: %s', (language, count) => {
    const seed = loadBundledCopilotSeed(123, language)
    expect(seed.copilots).toHaveLength(count)
    expect(new Set(seed.copilots.map((copilot) => copilot.id)).size).toBe(count)
    expect(seed.avatars.length).toBeGreaterThan(0)
    expect(seed.copilots.every((copilot) => copilot.id.endsWith(language.startsWith('zh') ? ':zh-Hans' : ':en'))).toBe(true)
    for (const avatar of seed.avatars) expect(avatar.data).toMatch(/^data:image\//)
    for (const copilot of seed.copilots) {
      expect(copilot.picUrl).toBeUndefined()
      expect(copilot.createdAt).toBe(123)
      expect(copilot.category).toBe(copilot.tags?.[0] ?? '')
      if (copilot.avatar) expect(copilot.avatar.type).toBe('storage-key')
    }
    const references = collectGlobalResourceReferences(undefined, seed.copilots)
    expect(new Set(references.map((reference) => reference.storageKey))).toEqual(
      new Set(seed.avatars.map((avatar) => avatar.storageKey))
    )
  })
})