import type { CopilotDetail } from '@shared/types'
import assistants from '../../../server/snapshot/assistants.json'

/** Legacy discovery reads use packaged definitions and locally seeded avatar keys. */
export function loadLocalCopilots(lang: string): CopilotDetail[] {
  const locale = lang.startsWith('zh') ? 'zh-Hans' : 'en'
  return assistants.filter((entry) => entry.enabled && entry.lang === locale).map((entry) => ({
    id: entry.id,
    name: entry.name,
    prompt: entry.prompt,
    description: entry.description,
    category: entry.tags[0] ?? '',
    tags: [...entry.tags],
    ...(entry.avatar_filename ? {
      avatar: { type: 'storage-key' as const, storageKey: `picture:bundled-copilot:${entry.avatar_filename}` },
    } : {}),
  }))
}