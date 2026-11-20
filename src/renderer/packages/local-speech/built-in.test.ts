// @vitest-environment jsdom

import { afterEach, expect, test, vi } from 'vitest'

const platform = vi.hoisted(() => ({ type: 'web' }))
vi.mock('@/platform', () => ({ default: platform }))
vi.mock('@/packages/navigator', () => ({ getOS: () => 'Linux' }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

test.each([
  ['web', false],
  ['desktop', true],
  ['mobile', true],
] as const)('keeps synthesis available and gates recognition on %s', async (type, enabled) => {
  platform.type = type
  const recognize = vi.fn()
  class Recognition {
    static available = vi.fn(async () => 'available')
    processLocally = false
    constructor() {
      recognize()
    }
  }
  const synthesis = { addEventListener: vi.fn(), getVoices: vi.fn(() => []) }
  vi.stubGlobal('SpeechRecognition', Recognition)
  vi.stubGlobal('speechSynthesis', synthesis)
  vi.stubGlobal('SpeechSynthesisUtterance', class {})
  const { getBuiltInSpeech } = await import('./built-in')
  const { playback, dictation } = getBuiltInSpeech()
  expect(playback).toBeDefined()
  if (enabled) {
    await expect(dictation?.availability('en-US')).resolves.toEqual({ kind: 'ready', language: 'en-US' })
  } else {
    expect(dictation).toBeUndefined()
    const { refreshDictationAvailability } = await import('./useDictationAvailability')
    await refreshDictationAvailability()
    expect(recognize).not.toHaveBeenCalled()
    expect(Recognition.available).not.toHaveBeenCalled()
  }
})
