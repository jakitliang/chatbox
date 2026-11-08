import type { CopilotDetail } from '@shared/types'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo } from 'react'
import {
  addOrUpdateMyCopilot,
  type CopilotMemoryOwner,
  copilotMemoryOwnersAtom,
  disableCopilotMemory,
  enableCopilotMemory,
  myCopilotsAtom,
  myCopilotsStatusAtom,
  readCopilotMemoryEnabled,
  reloadCopilotDefinitions,
  removeMyCopilot,
} from '@/stores/copilotStore'

export function useMyCopilots() {
  const copilots = useAtomValue(myCopilotsAtom)
  const status = useAtomValue(myCopilotsStatusAtom)

  // Sort my copilots: starred first
  const sortedCopilots = useMemo(() => {
    return [...copilots.filter((item) => item.starred), ...copilots.filter((item) => !item.starred)]
  }, [copilots])

  const addOrUpdate = (target: CopilotDetail) => {
    addOrUpdateMyCopilot(target).catch((error) => console.error('useMyCopilots: failed to save copilot', error))
  }

  const remove = (id: string) => {
    removeMyCopilot(id).catch((error) => console.error('useMyCopilots: failed to remove copilot', error))
  }

  return {
    copilots: sortedCopilots,
    addOrUpdate,
    remove,
    ...status,
    reload: reloadCopilotDefinitions,
  }
}

/** Which copilots keep their own memory list, and how to change that. */
export function useCopilotMemory() {
  const owners = useAtomValue(copilotMemoryOwnersAtom)

  const isEnabled = useCallback((copilotId: string) => owners.some((owner) => owner.id === copilotId), [owners])

  const setEnabled = (owner: CopilotMemoryOwner, enabled: boolean) => {
    const update = enabled ? enableCopilotMemory(owner) : disableCopilotMemory(owner.id)
    update.catch((error) => console.error('useCopilotMemory: failed to save memory ownership', error))
  }

  return { owners, isEnabled, readEnabled: readCopilotMemoryEnabled, setEnabled }
}

export function useRemoteCopilotTags() {
  // Compatibility for older hosts: there is no longer a remote/curated catalog.
  return { tags: [] as string[], isLoading: false, error: null }
}

type RemoteCopilotsByCursorFilters = {
  limit?: number
  tag?: string
  search?: string
}

export function useRemoteCopilotsByCursor(filters?: RemoteCopilotsByCursorFilters) {
  void filters
  return {
    copilots: [] as CopilotDetail[],
    fetchNextPage: async () => undefined,
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    error: null,
  }
}
