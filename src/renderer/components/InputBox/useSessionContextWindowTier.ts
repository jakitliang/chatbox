import type { ContextWindowTier } from '@shared/providers/context-window-tier'
import { useRef, useState } from 'react'
import { rendererApplication } from '@/app/renderer-application'

export function useSessionContextWindowTier(sessionId: string | undefined, savedTier: ContextWindowTier | undefined) {
  const [selection, setSelection] = useState<{ sessionId: string | undefined; tier?: ContextWindowTier }>({ sessionId })
  if (selection.sessionId !== sessionId) setSelection({ sessionId })

  const pendingWrite = useRef<Promise<void>>(Promise.resolve())
  const isDraft = !sessionId || sessionId === 'new'
  const tier = (selection.sessionId === sessionId ? selection.tier : undefined) ?? savedTier ?? 'default'

  function changeTier(nextTier: ContextWindowTier) {
    const change = { sessionId, tier: nextTier }
    setSelection(change)
    if (!sessionId || sessionId === 'new') return Promise.resolve()

    const write = pendingWrite.current
      .catch(() => undefined)
      .then(async () => {
        await rendererApplication.sessions.updateSessionHeader(sessionId, (session) => {
          if (!session) throw new Error('Session not found')
          return {
            ...session,
            settings: { ...session.settings, contextWindowTier: nextTier === 'default' ? undefined : nextTier },
          }
        })
      })
    pendingWrite.current = write
    return write.finally(() => {
      setSelection((current) => (current === change ? { sessionId } : current))
    })
  }

  return {
    tier,
    changeTier,
    draftPatch: isDraft && tier !== 'default' ? { contextWindowTier: tier } : undefined,
  }
}
