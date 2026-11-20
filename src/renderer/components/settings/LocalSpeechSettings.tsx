import { Button, Flex, Select, Stack, Text } from '@mantine/core'
import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { builtInPlaybackId, listSpeechModels, speechProviderId } from '@/packages/local-speech/playback-backends'
import {
  refreshLocalSpeech,
  selectVoice,
  setLocalSpeechVoice,
  setSpeechEngine,
  useLocalSpeech,
} from '@/packages/local-speech/store'
import {
  refreshDictationAvailability,
  useDictationAvailability,
} from '@/packages/local-speech/useDictationAvailability'
import { usePlayback } from '@/packages/local-speech/usePlayback'
import { useSettingsStore } from '@/stores/settingsStore'
import * as toastActions from '@/stores/toastActions'
import { DefaultModelSettingsCard } from './DefaultModelSettingsCard'

const preview = 'settings:speech-preview'
const builtInDictationId = 'built-in'
const fieldClass = 'w-full min-w-0 sm:w-[320px]'

function SpeechSettingsCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <DefaultModelSettingsCard role="group" aria-label={title}>
      <Stack gap={2}>
        <Text fw={600}>{title}</Text>
        <Text size="xs" c="chatbox-tertiary">
          {description}
        </Text>
      </Stack>
      {children}
    </DefaultModelSettingsCard>
  )
}

export default function LocalSpeechSettings() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const state = useLocalSpeech((state) => state)
  const models = listSpeechModels(useSettingsStore((settings) => settings.providers?.[speechProviderId]))
  const builtIn = state.engineId === builtInPlaybackId
  const missingModel = !builtIn && !models.some((model) => model.id === state.engineId)
  const voice = selectVoice(state, i18n.resolvedLanguage || i18n.language || 'en')
  const { available, playing, toggle } = usePlayback(preview, t('This is a preview of the selected voice.'))
  const dictation = useDictationAvailability()
  const dictationStatus =
    dictation.kind === 'ready'
      ? t('Voice input language: {{language}}', { language: dictation.language })
      : dictation.kind === 'checking'
        ? t('Checking for local dictation…')
        : dictation.kind === 'language-unavailable'
          ? t('No compatible local dictation language is installed.')
          : dictation.kind === 'error'
            ? t('Could not check local dictation.')
            : t('Local dictation is not available in this environment.')

  const statusText = {
    loading: t('Checking for local voices…'),
    error: t('Could not load local voices.'),
    unsupported: t('Speech synthesis is not available in this environment.'),
    'no-voices': builtIn
      ? t('No local voices are installed or exposed by this environment.')
      : t('This model did not report any speech voices.'),
    'missing-model': t(
      'The selected speech model is unavailable. Select another engine or refresh the model list in Model Provider settings.'
    ),
    ready: voice ? null : t('The saved voice is unavailable. Select another one.'),
  }[state.status]

  return (
    <Stack gap="sm">
      <Text fw={600}>{t('Speech recognition & speech synthesis')}</Text>
      <SpeechSettingsCard title={t('Speech recognition')} description={t('Convert speech to text.')}>
        <Select
          aria-label={t('Speech recognition') || 'Speech recognition'}
          className={fieldClass}
          data={[{ value: builtInDictationId, label: t('Built-in') }]}
          value={builtInDictationId}
          allowDeselect={false}
        />
        <Button
          size="compact-sm"
          variant="subtle"
          className="self-start"
          onClick={() => void refreshDictationAvailability()}
        >
          {t('Refresh')}
        </Button>
        <Text size="xs" c="chatbox-tertiary" role="status">
          {dictationStatus}
        </Text>
      </SpeechSettingsCard>
      <SpeechSettingsCard title={t('Speech synthesis')} description={t('Read replies aloud.')}>
        <Select
          label={t('Speech engine')}
          className={fieldClass}
          data={[
            { value: builtInPlaybackId, label: t('Built-in') },
            ...models.map(({ id, label }) => ({ value: id, label })),
          ]}
          value={missingModel ? null : state.engineId}
          allowDeselect={false}
          onChange={(id) => {
            if (id === null || id === state.engineId) return
            try {
              setSpeechEngine(id)
            } catch (error) {
              console.warn('Could not save the speech engine preference', error)
              toastActions.add(t('Could not save the speech engine preference.'))
            }
          }}
        />
        <Button
          onClick={() => void navigate({ to: '/settings/provider' })}
          size="compact-sm"
          variant="subtle"
          className="self-start"
        >
          {t('Model Provider')}
        </Button>
        {statusText && (
          <Text size="xs" c="chatbox-tertiary" role="status">
            {statusText}
          </Text>
        )}
        {state.voices.length > 0 && (
          <Select
            label={builtIn ? t('Local voice') : t('Speech voice')}
            className={fieldClass}
            data={state.voices.map(({ id, name, lang }) => ({ value: id, label: lang ? `${name} (${lang})` : name }))}
            value={voice?.id ?? null}
            allowDeselect={false}
            onChange={(id) => {
              if (id === null) return
              try {
                setLocalSpeechVoice(id)
              } catch (error) {
                console.warn('Could not save the local speech preference', error)
                toastActions.add(t('Could not save the local voice preference.'))
              }
            }}
          />
        )}
        <Flex gap="xs" wrap="wrap">
          {builtIn && state.status !== 'unsupported' && (
            <Button size="compact-sm" variant="subtle" onClick={() => void refreshLocalSpeech()}>
              {t('Refresh')}
            </Button>
          )}
          {(available || playing) && (
            <Button size="compact-sm" variant="light" onClick={toggle}>
              {playing ? t('Stop reading') : t('Preview voice')}
            </Button>
          )}
        </Flex>
      </SpeechSettingsCard>
    </Stack>
  )
}
