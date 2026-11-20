import { ActionIcon, Loader } from '@mantine/core'
import { IconMicrophone, IconPlayerStopFilled, IconX } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { AppTooltip } from '@/components/ui/tooltip'
import { isDictationEnabled } from '@/packages/local-speech/built-in'
import type { useComposerDictation } from './useComposerDictation'

export default function DictationButton({
  disabled,
  dictation,
}: {
  disabled: boolean
  dictation: ReturnType<typeof useComposerDictation>
}) {
  const { t } = useTranslation()
  if (!isDictationEnabled()) return null
  const { availability, view, toggle, cancel } = dictation
  const state = view ? (view.stopping ? 'stopping' : 'listening') : 'idle'

  const label =
    state === 'listening'
      ? t('Stop voice input')
      : state === 'stopping'
        ? t('Finishing voice input…')
        : t('Start voice input')
  const unavailable = availability.kind !== 'ready' && state === 'idle'
  return (
    <>
      {view && (
        <AppTooltip label={t('Cancel')} withArrow>
          <ActionIcon
            type="button"
            className="shrink-0 mb-1"
            size={32}
            radius="xl"
            variant="subtle"
            aria-label={t('Cancel')}
            onClick={cancel}
          >
            <ScalableIcon icon={IconX} size={16} />
          </ActionIcon>
        </AppTooltip>
      )}
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
    </>
  )
}
