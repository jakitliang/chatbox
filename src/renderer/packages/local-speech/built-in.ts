import { SPEECH_CHANNELS } from '@shared/local-speech'
import { getOS } from '@/packages/navigator'
import { createBrowserSpeech } from './browser'
import type { DictationBackend, SpeechPlaybackBackend } from './contracts'
import { browserDictation } from './dictation'

function createBuiltInSpeech(): { playback?: SpeechPlaybackBackend; dictation: DictationBackend } {
  const target = typeof window === 'undefined' ? undefined : window
  const ipc = target?.electronAPI
  if (!ipc || getOS() !== 'Windows') {
    return {
      playback:
        target?.speechSynthesis && typeof SpeechSynthesisUtterance === 'function'
          ? createBrowserSpeech(target, SpeechSynthesisUtterance)
          : undefined,
      dictation: browserDictation(target),
    }
  }
  return {
    playback: {
      getVoices: () => ipc.invoke(SPEECH_CHANNELS.voices),
      async speak(voice, text, signal) {
        signal.throwIfAborted()
        const stop = () =>
          void ipc.invoke(SPEECH_CHANNELS.stop).catch((error) => console.warn('Speech stop failed', error))
        signal.addEventListener('abort', stop, { once: true })
        try {
          await ipc.invoke(SPEECH_CHANNELS.speak, voice.id, text)
        } finally {
          signal.removeEventListener('abort', stop)
        }
      },
    },
    dictation: {
      async availability(language) {
        const languages: string[] = await ipc.invoke(SPEECH_CHANNELS.dictationLanguages)
        const lang = language.toLowerCase()
        const selected =
          languages.find((entry) => entry.toLowerCase() === lang) ??
          languages.find((entry) => entry.toLowerCase().split('-')[0] === lang.split('-')[0]) ??
          languages[0]
        return selected ? { kind: 'ready', language: selected } : { kind: 'language-unavailable' }
      },
      start(language) {
        const id = globalThis.crypto.randomUUID()
        const end = (cancel: boolean) => {
          void ipc
            .invoke(SPEECH_CHANNELS.dictationEnd, id, cancel)
            .catch((error) => console.warn('Could not end Windows dictation', error))
        }
        return {
          result: ipc.invoke(SPEECH_CHANNELS.dictationStart, id, language),
          stop: () => end(false),
          cancel: () => end(true),
        }
      },
    },
  }
}

let builtIn: ReturnType<typeof createBuiltInSpeech> | undefined
export function getBuiltInSpeech() {
  return (builtIn ??= createBuiltInSpeech())
}
