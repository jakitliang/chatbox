import type { ModelInterface } from '@shared/models/types'
import type { ProviderInfo, ProviderOptions, SessionSettings } from '@shared/types'
import { type ReasoningControlLevel, setReasoningProviderOptionsForModel } from '@shared/utils/reasoning-control'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createModel } from '@/adapters'
import { rendererApplication } from '@/app/renderer-application'

type SelectedModel = {
  provider: string
  modelId: string
}

interface UseReasoningControlStateOptions {
  currentSessionId?: string
  isNewSession: boolean
  model?: SelectedModel
  providers: ProviderInfo[]
  sessionProviderOptions?: ProviderOptions
}

interface ReasoningControlState {
  effectiveProviderOptions?: ProviderOptions
  isDirty: boolean
  modelInstance?: ModelInterface
  selectedProviderInfo?: ProviderInfo
  settingsPatch?: Partial<SessionSettings>
  handleReasoningLevelChange: (level: ReasoningControlLevel) => Promise<void>
  markSettingsCommitted: () => void
  waitForPendingPersist: () => Promise<void>
}

interface DraftReasoningEntry {
  options: ProviderOptions | undefined
}

export function useReasoningControlState({
  currentSessionId,
  isNewSession,
  model,
  providers,
  sessionProviderOptions,
}: UseReasoningControlStateOptions): ReasoningControlState {
  const [providerOptionsOverride, setProviderOptionsOverride] = useState<ProviderOptions | undefined>(undefined)
  const [isDirty, setIsDirty] = useState(false)
  // Draft levels chosen before the session exists, keyed per model so switching
  // models while composing the first message does not discard earlier choices.
  const [draftByModel, setDraftByModel] = useState<Record<string, DraftReasoningEntry>>({})

  const selectedProviderInfo = useMemo(
    () => (model ? providers.find((provider) => provider.id === model.provider) : undefined),
    [providers, model]
  )

  const provider = model?.provider
  const modelId = model?.modelId
  const [resolved, setResolved] = useState<{
    provider: string
    modelId: string
    providerInfo?: ProviderInfo
    instance: ModelInterface
  }>()
  useEffect(() => {
    if (!provider || !modelId) return
    let active = true
    void createModel({ provider, modelId })
      .then((instance) => {
        if (active) setResolved({ provider, modelId, providerInfo: selectedProviderInfo, instance })
      })
      .catch((error: unknown) => {
        if (active) console.error('Failed to resolve the selected model for reasoning controls', error)
      })
    return () => {
      active = false
    }
  }, [provider, modelId, selectedProviderInfo])
  const modelInstance =
    resolved &&
    resolved.provider === provider &&
    resolved.modelId === modelId &&
    resolved.providerInfo === selectedProviderInfo
      ? resolved.instance
      : undefined
  const modelKey = model ? `${model.provider}:${model.modelId}` : ''
  const sessionKey = currentSessionId || 'new'
  const resetKey = `${sessionKey}:${modelKey}`
  const lastResetKeyRef = useRef(resetKey)
  const lastSessionKeyRef = useRef(sessionKey)
  const changeSeqRef = useRef(0)
  const pendingPersistRef = useRef<Promise<void> | null>(null)
  // Holds the latest options until their persist succeeds, so submit can retry a failed write
  const unpersistedOptionsRef = useRef<{ providerOptions: ProviderOptions | undefined } | null>(null)

  useEffect(() => {
    if (lastResetKeyRef.current === resetKey) {
      return
    }
    lastResetKeyRef.current = resetKey
    setProviderOptionsOverride(undefined)
    setIsDirty(false)
    changeSeqRef.current += 1
    pendingPersistRef.current = null
    unpersistedOptionsRef.current = null
    // Drafts are keyed per model, so a model switch keeps them; only leaving the
    // composing context (session change, including creation) clears them.
    if (lastSessionKeyRef.current !== sessionKey) {
      lastSessionKeyRef.current = sessionKey
      setDraftByModel({})
    }
  }, [resetKey, sessionKey])

  const currentDraft = isNewSession ? draftByModel[modelKey] : undefined
  const effectiveProviderOptions = currentDraft
    ? currentDraft.options
    : isDirty
      ? providerOptionsOverride
      : sessionProviderOptions
  // Existing sessions persist level changes directly (see handleReasoningLevelChange);
  // the patch is only needed when the session does not exist yet and will be created on
  // submit. It carries every per-model draft; 'default' drafts need no entry since a
  // new session starts at the default level anyway.
  const settingsPatch = useMemo<Partial<SessionSettings> | undefined>(() => {
    if (!isNewSession) return undefined
    const byModel: Record<string, ProviderOptions> = {}
    for (const [key, entry] of Object.entries(draftByModel)) {
      if (entry.options) byModel[key] = entry.options
    }
    if (Object.keys(byModel).length === 0) return undefined
    return { providerOptionsByModel: byModel }
  }, [isNewSession, draftByModel])

  const persistProviderOptions = useCallback(
    async (sessionId: string, nextProviderOptions?: ProviderOptions) => {
      await rendererApplication.sessions.updateSessionHeader(sessionId, (session) => {
        if (!session) {
          throw new Error('Session not found')
        }
        return {
          ...session,
          settings: {
            ...session.settings,
            ...setReasoningProviderOptionsForModel(
              session.settings,
              model?.provider,
              model?.modelId,
              nextProviderOptions
            ),
          },
        }
      })
    },
    [model?.provider, model?.modelId]
  )

  const handleReasoningLevelChange = useCallback(
    async (level: ReasoningControlLevel) => {
      if (!modelInstance?.writeReasoningOptions) return
      const nextProviderOptions = modelInstance.writeReasoningOptions(level, effectiveProviderOptions)
      if (isNewSession || !currentSessionId) {
        setDraftByModel((prev) => ({ ...prev, [modelKey]: { options: nextProviderOptions } }))
        return
      }
      setProviderOptionsOverride(nextProviderOptions)
      setIsDirty(true)
      changeSeqRef.current += 1
      const seq = changeSeqRef.current
      unpersistedOptionsRef.current = { providerOptions: nextProviderOptions }
      const persistPromise = persistProviderOptions(currentSessionId, nextProviderOptions).then(() => {
        // Once persisted, the session cache carries the new options; fall back to it
        // unless another change started in the meantime.
        if (changeSeqRef.current === seq) {
          unpersistedOptionsRef.current = null
          setIsDirty(false)
        }
      })
      pendingPersistRef.current = persistPromise
      await persistPromise
    },
    [currentSessionId, effectiveProviderOptions, isNewSession, modelInstance, modelKey, persistProviderOptions]
  )

  // Called before submit so generation reads the new options from session settings.
  // Awaits the in-flight write and retries it once if it failed.
  const waitForPendingPersist = useCallback(async () => {
    if (isNewSession || !currentSessionId) {
      return
    }
    try {
      if (pendingPersistRef.current) {
        await pendingPersistRef.current
      }
    } catch {
      // fall through to the retry below
    }
    const unpersisted = unpersistedOptionsRef.current
    if (unpersisted) {
      const seq = changeSeqRef.current
      await persistProviderOptions(currentSessionId, unpersisted.providerOptions)
      if (changeSeqRef.current === seq) {
        unpersistedOptionsRef.current = null
        setIsDirty(false)
      }
    }
  }, [currentSessionId, isNewSession, persistProviderOptions])

  const markSettingsCommitted = useCallback(() => {
    setIsDirty(false)
    setDraftByModel({})
  }, [])

  return {
    effectiveProviderOptions,
    isDirty,
    modelInstance,
    selectedProviderInfo,
    settingsPatch,
    handleReasoningLevelChange,
    markSettingsCommitted,
    waitForPendingPersist,
  }
}
