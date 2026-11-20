// @vitest-environment jsdom

import { afterEach, expect, test, vi } from 'vitest'

import { SPEECH_CHANNELS } from '@shared/local-speech'

const getOS = vi.hoisted(() => vi.fn(() => 'Linux'))
vi.mock('@/packages/navigator', () => ({ getOS }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

test('uses browser synthesis when Windows speech IPC is not available', async () => {
  const voices = [{ voiceURI: 'local', name: 'Local voice', lang: 'en-US', localService: true, default: true }]
  const synthesis = { addEventListener: vi.fn(), getVoices: vi.fn(() => voices) }
  vi.stubGlobal('speechSynthesis', synthesis)
  vi.stubGlobal('SpeechSynthesisUtterance', class {})
  const { getBuiltInSpeech } = await import('./built-in')
  expect(getBuiltInSpeech()?.getVoices()).toEqual([expect.objectContaining({ id: 'local', name: 'Local voice' })])
})

test('keeps Windows voice discovery, playback and cancellation on the synthesis IPC channels', async () => {
  getOS.mockReturnValueOnce('Windows')
  const voice = { id: 'local', name: 'Local voice', lang: 'en-US' }
  let finishPlayback: (() => void) | undefined
  const invoke = vi.fn((channel: string) =>
    channel === SPEECH_CHANNELS.voices
      ? Promise.resolve([voice])
      : channel === SPEECH_CHANNELS.speak
        ? new Promise<void>((resolve) => {
            finishPlayback = resolve
          })
        : Promise.resolve()
  )
  vi.stubGlobal('electronAPI', { invoke })
  const { getBuiltInSpeech } = await import('./built-in')
  const playback = getBuiltInSpeech()
  expect(playback).toBeDefined()
  await expect(playback?.getVoices()).resolves.toEqual([voice])
  const abort = new AbortController()
  const reading = playback?.speak(voice, 'Hello', abort.signal)
  abort.abort()
  finishPlayback?.()
  await reading
  expect(invoke.mock.calls).toEqual([
    [SPEECH_CHANNELS.voices],
    [SPEECH_CHANNELS.speak, 'local', 'Hello'],
    [SPEECH_CHANNELS.stop],
  ])
})
