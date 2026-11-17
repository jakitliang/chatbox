import type { ProviderSettings } from '@shared/types'
import { useEffect, useSyncExternalStore } from 'react'
import {
  getRuntimeContextWindow,
  hasRuntimeContextWindow,
  refreshRuntimeContextWindow,
  subscribeRuntimeContextWindow,
} from './runtime-context-window'

export function useRuntimeContextWindow(
  providerId: string | undefined,
  modelId: string | undefined,
  settings: ProviderSettings | undefined,
  generating: boolean
): number | undefined {
  // Generation transitions refresh facts after a cold model has been loaded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: generation transitions invalidate runtime facts
  useEffect(() => {
    if (!providerId || !modelId || !hasRuntimeContextWindow(providerId)) return
    const refresh = () => void refreshRuntimeContextWindow(providerId, modelId, settings ?? {})
    refresh()
    const interval = setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [providerId, modelId, settings, generating])
  return useSyncExternalStore(subscribeRuntimeContextWindow, () =>
    providerId && modelId ? getRuntimeContextWindow(providerId, modelId, settings ?? {}) : undefined
  )
}
