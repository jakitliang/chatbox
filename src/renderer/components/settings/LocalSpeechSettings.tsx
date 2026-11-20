import { Badge, Button, Flex, Select, Stack, Text } from '@mantine/core'
import { useNavigate } from '@tanstack/react-router'
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
import {
  refreshDictationAvailability,
  useDictationAvailability,
} from '@/packages/local-speech/useDictationAvailability'
import * as toastActions from '@/stores/toastActions'
import { useSettingsStore } from '@/stores/settingsStore'

const preview = 'settings:speech-preview'

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
    <Stack gap="xs" pt="sm" className="border-0 border-t border-solid border-chatbox-border-primary">
      <Text size="sm" fw={500}>
        {t('Speech recognition & speech synthesis')}
      </Text>
      <Flex gap="xs" align="center">
        <Text size="sm">{t('Speech recognition')}</Text>
        <Badge variant="light">{t('Built-in')}</Badge>
        <Button size="compact-sm" variant="subtle" onClick={() => void refreshDictationAvailability()}>
          {t('Refresh')}
        </Button>
      </Flex>
      <Text size="xs" c="chatbox-tertiary" role="status">
        {dictationStatus}
      </Text>
      <Text size="sm">{t('Speech synthesis')}</Text>
      <Select
        label={t('Speech engine')}
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
      <Flex gap="xs">
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
    </Stack>
  )
}
