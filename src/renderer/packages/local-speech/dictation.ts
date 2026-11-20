import type { DictationAvailability, DictationBackend, DictationSession } from './contracts'

export type { DictationAvailability, DictationSession } from './contracts'

interface LocalRecognition extends EventTarget {
  processLocally: boolean
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
}

type RecognitionConstructor = {
  new (): LocalRecognition
  available?(options: { langs: string[]; processLocally: true }): Promise<string>
}

export class DictationError extends Error {
  constructor(readonly reason: 'permission' | 'failed') {
    super(`Local dictation: ${reason}`)
  }
}

export function createBrowserDictation(Recognition: RecognitionConstructor | undefined): DictationBackend {
  return {
    async availability(language: string): Promise<DictationAvailability> {
      if (!Recognition?.available || !('processLocally' in new Recognition())) return { kind: 'unsupported' }
      const status = await Recognition.available({ langs: [language], processLocally: true })
      return status === 'available' ? { kind: 'ready', language } : { kind: 'language-unavailable' }
    },
    start(language, onUpdate): DictationSession {
      if (!Recognition?.available) throw new Error('Local recognition is unavailable')
      const recognition = new Recognition()
      if (!('processLocally' in recognition)) throw new Error('Local recognition is unavailable')
      recognition.processLocally = true
      recognition.lang = language
      recognition.interimResults = true
      recognition.continuous = true
      let transcript = ''
      let stopping = false
      let cancelled = false
      let finished = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let deadline: ReturnType<typeof setTimeout> | undefined
      let resolveResult: (value: string) => void = () => {}
      let rejectResult: (reason: unknown) => void = () => {}
      const result = new Promise<string>((resolve, reject) => {
        const settle = () => {
          if (finished) return false
          finished = true
          clearTimeout(timer)
          clearTimeout(deadline)
          return true
        }
        resolveResult = (text) => {
          if (settle()) resolve(text)
        }
        rejectResult = (error) => {
          if (settle()) reject(error)
        }
        recognition.addEventListener('result', (event) => {
          if (cancelled || finished) return
          const results = (
            event as Event & {
              results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
            }
          ).results
          const parts = Array.from(results)
          const join = (final: boolean) =>
            parts
              .filter((entry) => entry.isFinal === final)
              .map((entry) => entry[0].transcript.trim())
              .filter(Boolean)
              .join(' ')
          transcript = join(true)
          onUpdate?.({ confirmed: transcript, interim: stopping ? '' : join(false) })
        })
        recognition.addEventListener('end', () => resolveResult(cancelled ? '' : transcript), { once: true })
        recognition.addEventListener(
          'error',
          (event) => {
            const { error } = event as Event & { error: string }
            if (cancelled || error === 'no-speech' || (stopping && error === 'aborted')) {
              resolveResult(cancelled ? '' : transcript)
            } else {
              rejectResult(
                new DictationError(error === 'not-allowed' || error === 'service-not-allowed' ? 'permission' : 'failed')
              )
            }
          },
          { once: true }
        )
        try {
          recognition.start()
        } catch (error) {
          rejectResult(error)
        }
      })
      if (!finished) timer = setTimeout(stop, 120_000)
      function stop() {
        if (stopping || cancelled || finished) return
        stopping = true
        try {
          deadline = setTimeout(() => {
            try {
              recognition.abort()
              resolveResult(transcript)
            } catch (error) {
              rejectResult(error)
            }
          }, 3_000)
          recognition.stop()
        } catch (error) {
          rejectResult(error)
        }
      }
      return {
        result,
        stop,
        cancel() {
          if (cancelled || finished) return
          cancelled = true
          try {
            recognition.abort()
          } catch (error) {
            rejectResult(error)
          } finally {
            resolveResult('')
          }
        },
      }
    },
  }
}

export function browserDictation(target?: Window) {
  const speechWindow = target as
    | (Window & {
        SpeechRecognition?: RecognitionConstructor
        webkitSpeechRecognition?: RecognitionConstructor
      })
    | undefined
  return createBrowserDictation(speechWindow?.SpeechRecognition ?? speechWindow?.webkitSpeechRecognition)
}

export function appendDictation(draft: string, transcript: string) {
  const text = transcript.trim()
  if (!text) return draft
  return `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${text}`
}
