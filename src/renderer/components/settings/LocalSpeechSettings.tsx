import { Button, Flex, Select, Stack, Text } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { builtInPlaybackId, listSpeechModels, speechProviderId } from '@/packages/local-speech/playback-backends'
import {
  refreshLocalSpeech,
  selectVoice,
  setLocalSpeechVoice,
  setSpeechEngine,
  useLocalSpeech,
} from '@/packages/local-speech/store'
import { usePlayback } from '@/packages/local-speech/usePlayback'
import { useSettingsStore } from '@/stores/settingsStore'
import * as toastActions from '@/stores/toastActions'
import {
  DefaultModelSettingsCard,
  defaultModelCardAction,
  defaultModelCardFieldClass,
  defaultModelCardLink,
} from './DefaultModelSettingsCard'

const preview = 'settings:speech-preview'

export default function LocalSpeechSettings() {
  const { t, i18n } = useTranslation()
  const state = useLocalSpeech((state) => state)
  const models = listSpeechModels(useSettingsStore((settings) => settings.providers?.[speechProviderId]))
  const builtIn = state.engineId === builtInPlaybackId
  const missingModel = !builtIn && !models.some((model) => model.id === state.engineId)
  const voice = selectVoice(state, i18n.resolvedLanguage || i18n.language || 'en')
  const { available, playing, toggle } = usePlayback(preview, t('This is a preview of the selected voice.'))
  const canRefreshVoices = builtIn && state.status !== 'unsupported'
  const showPreviewControl = available || playing
  const title = t('Speech synthesis', { defaultValue: 'Speech synthesis' })

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
      <Stack gap={2}>
        <Text fw={600}>{title}</Text>
        <Text size="xs" c="chatbox-tertiary">
          {t('Read replies aloud.')}
        </Text>
      </Stack>
      <DefaultModelSettingsCard role="group" aria-label={title}>
        <Select
          label={t('Speech engine')}
          className={defaultModelCardFieldClass}
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
        <Button component={Link} to="/settings/provider" {...defaultModelCardLink}>
          {t('Model Provider')}
        </Button>
        {statusText && (
          <Text size="xs" c="chatbox-tertiary" role="status">
            {statusText}
          </Text>
        )}
        {(state.voices.length > 0 || canRefreshVoices || showPreviewControl) && (
          <Flex align="flex-end" gap="xs" wrap="wrap">
            {state.voices.length > 0 && (
              <Select
                label={builtIn ? t('Local voice') : t('Speech voice')}
                className={defaultModelCardFieldClass}
                data={state.voices.map(({ id, name, lang }) => ({
                  value: id,
                  label: lang ? `${name} (${lang})` : name,
                }))}
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
            {(canRefreshVoices || showPreviewControl) && (
              <Flex gap="xs" wrap="wrap" className="max-w-full">
                {canRefreshVoices && (
                  <Button {...defaultModelCardAction} onClick={() => void refreshLocalSpeech()}>
                    {t('Refresh')}
                  </Button>
                )}
                {showPreviewControl && (
                  <Button {...defaultModelCardAction} onClick={toggle}>
                    {playing ? t('Stop reading') : t('Preview voice')}
                  </Button>
                )}
              </Flex>
            )}
          </Flex>
        )}
      </DefaultModelSettingsCard>
    </Stack>
  )
}
