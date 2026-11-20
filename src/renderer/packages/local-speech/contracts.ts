import type { LocalSpeechVoice } from '@shared/local-speech'

export interface SpeechPlaybackBackend {
  getVoices(): LocalSpeechVoice[] | Promise<LocalSpeechVoice[]>
  subscribe?(refresh: () => void): void
  speak(voice: LocalSpeechVoice, text: string, signal: AbortSignal): Promise<void>
}

export type DictationAvailability =
  | { kind: 'ready'; language: string }
  | { kind: 'unsupported' | 'language-unavailable' }

export interface DictationSession {
  result: Promise<string>
  stop(): void
  cancel(): void
}

export interface DictationBackend {
  availability(language: string): Promise<DictationAvailability>
  start(language: string): DictationSession
}
