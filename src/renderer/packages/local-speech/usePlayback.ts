import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import * as toastActions from '@/stores/toastActions'
import { playLocalSpeech, selectVoice, stopLocalSpeech, useLocalSpeech } from './store'

export function usePlayback(owner: string, text: string) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage || i18n.language || 'en'
  const available = useLocalSpeech((state) => Boolean(text.trim() && selectVoice(state, language)))
  const playing = useLocalSpeech((state) => state.playingId === owner)
  useEffect(() => () => stopLocalSpeech(owner), [owner])
  const toggle = useCallback(() => {
    if (playing) {
      stopLocalSpeech(owner)
    } else {
      void playLocalSpeech(owner, text, language).catch((error) => {
        console.warn('Speech playback failed', error)
        toastActions.add(t('Could not play speech. Check the selected engine and voice.'))
      })
    }
  }, [playing, owner, text, language, t])
  return { available, playing, toggle }
}
