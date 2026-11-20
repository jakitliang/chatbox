import type { LocalSpeechVoice } from '@shared/local-speech'
import { useEffect } from 'react'
import { create } from 'zustand'
import { settingsStore } from '@/stores/settingsStore'
import { getBuiltInSpeech } from './built-in'
import type { SpeechPlaybackBackend } from './contracts'
import { builtInPlaybackId, resolvePlayback, speechProviderId } from './playback-backends'

type Status = 'loading' | 'ready' | 'no-voices' | 'unsupported' | 'error' | 'missing-model'
interface State {
  engineId: string
  status: Status
  voices: LocalSpeechVoice[]
  preferredVoiceId: string | null
  playingId: string | null
}

const preferenceKey = 'chatbox-local-speech-voice'
const engineKey = 'chatbox-speech-engine'

function readPreference(key: string) {
  try {
    return localStorage.getItem(key)
  } catch (error) {
    console.warn('Could not read the local speech preference', error)
    return null
  }
}

const store = create<State>(() => ({
  engineId: builtInPlaybackId,
  status: 'loading',
  voices: [],
  preferredVoiceId: null,
  playingId: null,
}))
let backend: SpeechPlaybackBackend | undefined
let initialized = false
let refreshId = 0
let playback: AbortController | undefined

export async function refreshLocalSpeech() {
  const id = ++refreshId
  if (!backend) {
    store.setState({
      status: store.getState().engineId === builtInPlaybackId ? 'unsupported' : 'missing-model',
      voices: [],
    })
    return
  }
  try {
    const voices = await backend.getVoices()
    if (id !== refreshId) return
    store.setState({ voices, status: voices.length > 0 ? 'ready' : 'no-voices' })
  } catch (error) {
    if (id !== refreshId) return
    console.warn('Could not load local speech voices', error)
    store.setState({ status: 'error', voices: [] })
  }
}

function initialize() {
  if (initialized) return
  initialized = true
  getBuiltInSpeech().playback?.subscribe?.(() => {
    if (store.getState().engineId === builtInPlaybackId) void refreshLocalSpeech()
  })
  settingsStore.subscribe((next, prev) => {
    if (
      store.getState().engineId !== builtInPlaybackId &&
      next.providers?.[speechProviderId] !== prev.providers?.[speechProviderId]
    ) {
      configureEngine(store.getState().engineId)
    }
  })
  configureEngine(readPreference(engineKey) ?? builtInPlaybackId)
}

function voicePreferenceKey(engineId: string) {
  return engineId === builtInPlaybackId ? preferenceKey : `${preferenceKey}:${engineId}`
}

function configureEngine(engineId: string) {
  const playingId = store.getState().playingId
  if (playingId !== null) stopLocalSpeech(playingId)
  backend = resolvePlayback(engineId, settingsStore.getState().providers?.[speechProviderId])
  store.setState({
    engineId,
    voices: [],
    status: 'loading',
    preferredVoiceId: readPreference(voicePreferenceKey(engineId)),
  })
  void refreshLocalSpeech()
}

export function setSpeechEngine(engineId: string) {
  localStorage.setItem(engineKey, engineId)
  configureEngine(engineId)
}

export function useLocalSpeech<T>(selector: (state: State) => T): T {
  useEffect(initialize, [])
  return store(selector)
}

export function selectVoice(state: Pick<State, 'voices' | 'preferredVoiceId'>, language: string) {
  const { preferredVoiceId, voices } = state
  if (preferredVoiceId !== null) return voices.find((voice) => voice.id === preferredVoiceId)
  const lang = language
    .toLowerCase()
    .replace(/^zh-hans$/, 'zh-cn')
    .replace(/^zh-hant$/, 'zh-tw')
  const baseLanguage = lang.split('-')[0]
  return (
    voices.find((voice) => voice.lang.toLowerCase() === lang) ??
    voices.find((voice) => voice.lang.toLowerCase().split('-')[0] === baseLanguage) ??
    voices[0]
  )
}

export function setLocalSpeechVoice(id: string) {
  localStorage.setItem(voicePreferenceKey(store.getState().engineId), id)
  store.setState({ preferredVoiceId: id })
}

export function stopLocalSpeech(owner: string) {
  if (store.getState().playingId !== owner) return
  const playing = playback
  playback = undefined
  playing?.abort()
  store.setState({ playingId: null })
}

export async function playLocalSpeech(owner: string, text: string, language: string) {
  const voice = selectVoice(store.getState(), language)
  if (!backend || !voice || !text.trim()) throw new Error('Local speech is unavailable')
  playback?.abort()
  const playing = new AbortController()
  playback = playing
  store.setState({ playingId: owner })
  try {
    await backend.speak(voice, text, playing.signal)
  } catch (error) {
    if (!playing.signal.aborted) throw error
  } finally {
    if (playback === playing) {
      playback = undefined
      store.setState({ playingId: null })
    }
  }
}
