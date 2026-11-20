import { SPEECH_CHANNELS } from '@shared/local-speech'
import { getOS } from '@/packages/navigator'
import { createBrowserSpeech } from './browser'
import type { SpeechPlaybackBackend } from './contracts'

function createBuiltInSpeech(): SpeechPlaybackBackend | undefined {
  const target = typeof window === 'undefined' ? undefined : window
  const ipc = target?.electronAPI
  if (!ipc || getOS() !== 'Windows') {
    return target?.speechSynthesis && typeof SpeechSynthesisUtterance === 'function'
      ? createBrowserSpeech(target, SpeechSynthesisUtterance)
      : undefined
  }
  return {
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
  }
}

let builtIn: SpeechPlaybackBackend | null | undefined
export function getBuiltInSpeech() {
  if (builtIn === undefined) builtIn = createBuiltInSpeech() ?? null
  return builtIn ?? undefined
}
