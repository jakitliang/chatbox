import { useEffect, useSyncExternalStore } from 'react'
import { getBuiltInSpeech } from './built-in'
import type { DictationAvailability } from './contracts'

type Status = DictationAvailability | { kind: 'checking' | 'error' }
let status: Status = { kind: 'checking' }
let request: Promise<void> | undefined
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function refreshDictationAvailability() {
  if (request) return request
  const language = typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US'
  request = getBuiltInSpeech()
    .dictation.availability(language)
    .then(
      (next) => {
        status = next
      },
      (error) => {
        console.warn('Could not check local dictation availability', error)
        status = { kind: 'error' }
      }
    )
    .finally(() => {
      request = undefined
      listeners.forEach((listener) => listener())
    })
  return request
}

export function useDictationAvailability() {
  useEffect(() => {
    void refreshDictationAvailability()
  }, [])
  return useSyncExternalStore(subscribe, () => status)
}
