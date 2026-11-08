import type { CopilotDetail } from '@shared/types'
import type { KeyValueStoragePort } from '../../ports'
import { isCopilotDetail, MY_COPILOTS_STORAGE_KEY } from './CopilotService'

/** Never version this key: catalog updates must not resurrect deleted assistants. */
export const LOCAL_COPILOTS_INITIALIZED_STORAGE_KEY = 'local-copilots-initialized'

/** Call under the host's definition hydration/mutation lock. Missing is not the same as an empty list. */
export async function initializeLocalCopilots(
  storage: Pick<KeyValueStoragePort, 'get' | 'set'>,
  loadSeed: () => Promise<CopilotDetail[]>
): Promise<CopilotDetail[]> {
  const stored = await storage.get<unknown>(MY_COPILOTS_STORAGE_KEY)
  if (stored !== null && (!Array.isArray(stored) || !stored.every(isCopilotDetail))) {
    throw new Error('Invalid saved Copilots')
  }
  const initialized = await storage.get<unknown>(LOCAL_COPILOTS_INITIALIZED_STORAGE_KEY)
  if (stored !== null || initialized !== null) {
    // Also mark upgrades/restores with existing data, including deliberately empty lists.
    if (initialized === null) await storage.set(LOCAL_COPILOTS_INITIALIZED_STORAGE_KEY, true)
    return stored ?? []
  }
  const seed = await loadSeed()
  if (!seed.every(isCopilotDetail)) throw new Error('Invalid bundled Copilots')
  // Assets are durable before loadSeed resolves. Write definitions before the marker;
  // an interrupted marker write then finds existing definitions and cannot duplicate them.
  await storage.set(MY_COPILOTS_STORAGE_KEY, seed)
  await storage.set(LOCAL_COPILOTS_INITIALIZED_STORAGE_KEY, true)
  return seed
}

export function getCopilotCategories(copilots: readonly CopilotDetail[]): string[] {
  return [...new Set(copilots.map((copilot) => copilot.category?.trim()).filter((value): value is string => !!value))]
    .sort((a, b) => a.localeCompare(b))
}

/** undefined means all, empty string means uncategorized. */
export function filterCopilotsByCategory(copilots: readonly CopilotDetail[], category?: string): CopilotDetail[] {
  return copilots.filter((copilot) => category === undefined || (copilot.category?.trim() ?? '') === category)
}