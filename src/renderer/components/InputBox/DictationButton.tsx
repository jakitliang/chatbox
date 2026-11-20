import { ActionIcon, Loader } from '@mantine/core'
import { IconMicrophone, IconPlayerStopFilled } from '@tabler/icons-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { AppTooltip } from '@/components/ui/tooltip'
import { getBuiltInSpeech } from '@/packages/local-speech/built-in'
import { DictationError, type DictationSession } from '@/packages/local-speech/dictation'
import {
  refreshDictationAvailability,
  useDictationAvailability,
} from '@/packages/local-speech/useDictationAvailability'
import * as toastActions from '@/stores/toastActions'

export default function DictationButton({
  disabled,
  onTranscript,
}: {
  disabled: boolean
  onTranscript: (text: string) => void
}) {
  const { t } = useTranslation()
  const availability = useDictationAvailability()
  const session = useRef<DictationSession | null>(null)
  const [state, setState] = useState<'idle' | 'listening' | 'stopping'>('idle')

  useLayoutEffect(() => {
    if (disabled) setState('idle')
    return () => {
      const current = session.current
      session.current = null
      current?.cancel()
    }
  }, [disabled])

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
    if (session.current) {
      setState('stopping')
      session.current.stop()
      return
    }
    if (disabled || availability.kind !== 'ready') return
    let active: DictationSession
    try {
      active = getBuiltInSpeech().dictation.start(availability.language)
    } catch (error) {
      report(error)
      return
    }
    session.current = active
    setState('listening')
    try {
      const text = await active.result
      if (session.current !== active) return
      if (text.trim()) onTranscript(text)
      else toastActions.add(t('No speech was recognized.'))
    } catch (error) {
      if (session.current === active) report(error)
    } finally {
      if (session.current === active) {
        session.current = null
        setState('idle')
      }
    }
  }

  const label =
    state === 'listening'
      ? t('Stop voice input')
      : state === 'stopping'
        ? t('Finishing voice input…')
        : t('Start voice input')
  const unavailable = availability.kind !== 'ready' && state === 'idle'
  return (
    <AppTooltip label={unavailable ? t('Local dictation is not available in this environment.') : label} withArrow>
      <span className="shrink-0 mb-1 inline-flex">
        <ActionIcon
          type="button"
          size={32}
          radius="xl"
          variant={state === 'listening' ? 'filled' : 'subtle'}
          color={state === 'listening' ? 'red' : 'chatbox-tertiary'}
          aria-label={label}
          aria-busy={state === 'stopping' || availability.kind === 'checking'}
          disabled={disabled || unavailable || state === 'stopping'}
          onClick={() => void toggle()}
        >
          {state === 'stopping' ? (
            <Loader size={16} />
          ) : (
            <ScalableIcon icon={state === 'listening' ? IconPlayerStopFilled : IconMicrophone} size={16} />
          )}
        </ActionIcon>
      </span>
    </AppTooltip>
  )
}
