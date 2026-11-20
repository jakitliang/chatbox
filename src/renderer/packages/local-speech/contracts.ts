import type { LocalSpeechVoice } from '@shared/local-speech'

export interface SpeechPlaybackBackend {
  getVoices(): LocalSpeechVoice[] | Promise<LocalSpeechVoice[]>
  subscribe?(refresh: () => void): void
  speak(voice: LocalSpeechVoice, text: string, signal: AbortSignal): Promise<void>
}
