import type { CopilotDetail } from '@shared/types'
import assistants from '../../../server/snapshot/assistants.json'

// These are build inputs, not backend URLs. Vite includes the downloaded bytes
// in the application bundle; neither Flask nor the snapshot directory is needed at runtime.
const avatars = import.meta.glob<string>('../../../server/snapshot/avatars/*.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?inline',
  import: 'default',
})

export interface BundledCopilotSeed {
  copilots: CopilotDetail[]
  avatars: { storageKey: string; data: string }[]
}

/** Only one locale is seeded; later language switches never replace user data. */
export function loadBundledCopilotSeed(now = Date.now(), language = 'en'): BundledCopilotSeed {
  const locale = language.toLowerCase().startsWith('zh') ? 'zh-Hans' : 'en'
  const pictures = new Map<string, string>()
  const copilots: CopilotDetail[] = assistants.filter((assistant) => assistant.enabled && assistant.lang === locale).map((assistant) => {
    const filename = assistant.avatar_filename
    const data = filename ? avatars[`../../../server/snapshot/avatars/${filename}`] : undefined
    if (filename && !data) throw new Error(`Missing bundled copilot avatar: ${filename}`)
    const storageKey = filename ? `picture:bundled-copilot:${filename}` : undefined
    if (storageKey && data) pictures.set(storageKey, data)
    return {
      id: assistant.id,
      name: assistant.name,
      prompt: assistant.prompt,
      description: assistant.description,
      category: assistant.tags[0] ?? '',
      tags: [...assistant.tags],
      ...(storageKey ? { avatar: { type: 'storage-key' as const, storageKey } } : {}),
      createdAt: now,
      updatedAt: now,
    }
  })
  return { copilots, avatars: [...pictures].map(([storageKey, data]) => ({ storageKey, data })) }
}