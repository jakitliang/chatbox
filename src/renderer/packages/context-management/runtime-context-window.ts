import { getProviderDefinition } from '@shared/providers/registry'
import type { ProviderSettings } from '@shared/types'
import { apiRequest } from '@/utils/request'

const snapshots = new Map<string, number | undefined>()
const pending = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

function source(providerId: string, modelId: string, settings: ProviderSettings) {
  const delegate = getProviderDefinition(providerId)?.contextWindowDelegate
  return delegate && { delegate, key: JSON.stringify([providerId, delegate.getCacheKey(settings), modelId]) }
}

export function hasRuntimeContextWindow(providerId: string): boolean {
  return !!getProviderDefinition(providerId)?.contextWindowDelegate
}

export function subscribeRuntimeContextWindow(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getRuntimeContextWindow(
  providerId: string,
  modelId: string,
  settings: ProviderSettings
): number | undefined {
  const entry = source(providerId, modelId, settings)
  return entry ? snapshots.get(entry.key) : undefined
}

/** Generic orchestration only. Providers opt in and own protocol details; no window-size guesses. */
export async function refreshRuntimeContextWindow(
  providerId: string,
  modelId: string,
  settings: ProviderSettings
): Promise<void> {
  const entry = source(providerId, modelId, settings)
  if (!entry) return
  const { delegate, key } = entry
  const existing = pending.get(key)
  if (existing) return existing
  const operation = (async () => {
    let value: number | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const abort = new AbortController()
    try {
      value = await Promise.race([
        delegate.resolve(
          settings,
          modelId,
          (url, options) => apiRequest.get(url, {}, { ...options, retry: 0 }),
          abort.signal
        ),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new Error('Runtime context probe timed out'))
            abort.abort()
          }, 3000)
        }),
      ])
      if (!Number.isSafeInteger(value) || !value || value <= 0) value = undefined
    } catch {
      // Failed/unloaded runtime sources are unknown, never a fabricated small window.
    } finally {
      clearTimeout(timeout)
    }
    snapshots.set(key, value)
    for (const listener of listeners) listener()
  })()
  pending.set(key, operation)
  try {
    await operation
  } finally {
    pending.delete(key)
  }
}
