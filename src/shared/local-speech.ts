export interface LocalSpeechVoice {
  id: string
  name: string
  lang: string
}

export const SPEECH_CHANNELS = {
  voices: 'local-speech:voices',
  speak: 'local-speech:speak',
  stop: 'local-speech:stop',
  dictationLanguages: 'local-speech:dictation-languages',
  dictationStart: 'local-speech:dictation-start',
  dictationUpdate: 'local-speech:dictation-update',
  dictationEnd: 'local-speech:dictation-end',
} as const
