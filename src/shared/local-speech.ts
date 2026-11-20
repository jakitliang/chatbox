export interface LocalSpeechVoice {
  id: string
  name: string
  lang: string
}

export const SPEECH_CHANNELS = {
  voices: 'local-speech:voices',
  speak: 'local-speech:speak',
  stop: 'local-speech:stop',
} as const
