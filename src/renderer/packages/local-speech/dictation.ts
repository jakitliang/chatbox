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
    start(language: string): DictationSession {
      if (!Recognition?.available) throw new Error('Local recognition is unavailable')
      const recognition = new Recognition()
      if (!('processLocally' in recognition)) throw new Error('Local recognition is unavailable')
      recognition.processLocally = true
      recognition.lang = language
      recognition.interimResults = false
      recognition.continuous = true
      let transcript = ''
      let stopping = false
      let cancelled = false
      let resolveResult: (value: string) => void = () => {}
      let rejectResult: (reason: unknown) => void = () => {}
      const result = new Promise<string>((resolve, reject) => {
        resolveResult = resolve
        rejectResult = reject
        recognition.addEventListener('result', (event) => {
          const results = (
            event as Event & {
              results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
            }
          ).results
          transcript = Array.from(results)
            .filter((entry) => entry.isFinal)
            .map((entry) => entry[0].transcript.trim())
            .filter(Boolean)
            .join(' ')
        })
        recognition.addEventListener('end', () => resolve(cancelled ? '' : transcript), { once: true })
        recognition.addEventListener(
          'error',
          (event) => {
            const { error } = event as Event & { error: string }
            if (cancelled || error === 'no-speech' || (stopping && error === 'aborted')) {
              resolve(cancelled ? '' : transcript)
            } else {
              reject(
                new DictationError(error === 'not-allowed' || error === 'service-not-allowed' ? 'permission' : 'failed')
              )
            }
          },
          { once: true }
        )
        recognition.start()
      })
      const timer = setTimeout(stop, 120_000)
      const deadline = setTimeout(() => {
        try {
          recognition.abort()
        } catch (error) {
          rejectResult(error)
        } finally {
          resolveResult(cancelled ? '' : transcript)
        }
      }, 130_000)
      const finish = () => {
        clearTimeout(timer)
        clearTimeout(deadline)
      }
      void result.then(finish, finish)
      function stop() {
        if (stopping || cancelled) return
        stopping = true
        try {
          recognition.stop()
        } catch (error) {
          rejectResult(error)
        }
      }
      return {
        result,
        stop,
        cancel() {
          if (cancelled) return
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
