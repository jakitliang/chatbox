import type { SpeechPlaybackBackend } from './contracts'

export function createBrowserSpeech(
  target: Pick<Window, 'speechSynthesis'>,
  Utterance: typeof SpeechSynthesisUtterance
): SpeechPlaybackBackend {
  const synth = target.speechSynthesis
  const localVoices = () => synth.getVoices().filter((voice) => voice.localService === true)
  return {
    getVoices: () => localVoices().map((voice) => ({ id: voice.voiceURI, name: voice.name, lang: voice.lang })),
    subscribe: (refresh) => synth.addEventListener('voiceschanged', refresh),
    async speak(voice, text, signal) {
      // Some browser engines stop early on long utterances. Keep each utterance short.
      const chunks = text.match(/[\s\S]{1,200}(?:[。！？.!?]\s*|\s|$)|[\s\S]{1,200}/gu) ?? []
      for (const chunk of chunks) {
        if (signal.aborted) return
        const selected = localVoices().find((item) => item.voiceURI === voice.id)
        if (!selected) throw new Error('Local speech voice is no longer available')
        await new Promise<void>((resolve, reject) => {
          const utterance = new Utterance(chunk)
          utterance.voice = selected
          utterance.lang = selected.lang
          function finish() {
            signal.removeEventListener('abort', stop)
            utterance.onend = null
            utterance.onerror = null
          }
          function stop() {
            finish()
            synth.cancel()
            resolve()
          }
          utterance.onend = () => {
            finish()
            resolve()
          }
          utterance.onerror = (event) => {
            finish()
            reject(new Error(event.error))
          }
          signal.addEventListener('abort', stop, { once: true })
          try {
            synth.speak(utterance)
          } catch (error) {
            finish()
            reject(error)
          }
        })
      }
    },
  }
}
