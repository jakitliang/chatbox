import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getBuiltInSpeech } from '@/packages/local-speech/built-in'
import type { DictationSession, DictationUpdate } from '@/packages/local-speech/contracts'
import { DictationError } from '@/packages/local-speech/dictation'
import {
  refreshDictationAvailability,
  useDictationAvailability,
} from '@/packages/local-speech/useDictationAvailability'
import * as toastActions from '@/stores/toastActions'

type Capture = {
  scope: string
  session: DictationSession
  lifetime: AbortController
  phase: 'listening' | 'stopping' | 'committing'
}

function discard(capture: Capture | null) {
  capture?.lifetime.abort()
  capture?.session.cancel()
}

export function useComposerDictation(
  scope: string,
  disabled: boolean,
  onTranscript: (text: string, signal: AbortSignal) => Promise<void> | undefined
) {
  const { t } = useTranslation()
  const availability = useDictationAvailability()
  const capture = useRef<Capture | null>(null)
  const [view, setView] = useState<(DictationUpdate & { stopping: boolean }) | null>(null)
  const isActive = useCallback(() => capture.current !== null, [])

  const cancel = useCallback(() => {
    const current = capture.current
    capture.current = null
    setView(null)
    discard(current)
  }, [])

  useLayoutEffect(() => {
    if (capture.current && (disabled || capture.current.scope !== scope)) cancel()
  }, [scope, disabled, cancel])

  useLayoutEffect(
    () => () => {
      const current = capture.current
      capture.current = null
      discard(current)
    },
    []
  )

  function report(error: unknown) {
    console.warn('Device dictation failed', error)
    toastActions.add(
      error instanceof DictationError && error.reason === 'permission'
        ? t('Microphone access was denied.')
        : t('Could not use local dictation. Check your microphone and language support.')
    )
    void refreshDictationAvailability()
  }

  async function toggle() {
    const active = capture.current
    if (active) {
      if (active.phase !== 'listening') return
      active.phase = 'stopping'
      setView((prev) => prev && { ...prev, interim: '', stopping: true })
      active.session.stop()
      return
    }
    if (disabled || availability.kind !== 'ready') return
    let current: Capture | undefined
    try {
      const session = getBuiltInSpeech().dictation.start(availability.language, (update) => {
        if (!current || capture.current !== current || current.phase === 'committing') return
        const stopping = current.phase === 'stopping'
        setView({ ...update, interim: stopping ? '' : update.interim, stopping })
      })
      current = { scope, session, lifetime: new AbortController(), phase: 'listening' }
    } catch (error) {
      report(error)
      return
    }
    capture.current = current
    setView({ confirmed: '', interim: '', stopping: false })
    try {
      const text = await current.session.result
      if (capture.current !== current) return
      if (text.trim()) {
        current.phase = 'committing'
        setView({ confirmed: text, interim: '', stopping: true })
        await onTranscript(text, current.lifetime.signal)
      } else {
        toastActions.add(t('No speech was recognized.'))
      }
    } catch (error) {
      if (capture.current === current) report(error)
    } finally {
      if (capture.current === current) {
        capture.current = null
        setView(null)
      }
    }
  }

  return { view, availability, toggle, cancel, isActive }
}
