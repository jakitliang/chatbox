// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import LocalSpeechSettings from './LocalSpeechSettings'

const refreshDictationAvailability = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { language: string }) => key.replace('{{language}}', options?.language ?? ''),
    i18n: { language: 'en-US' },
  }),
}))
vi.mock('@/packages/local-speech/playback-backends', () => ({
  builtInPlaybackId: 'built-in',
  speechProviderId: 'ollama',
  listSpeechModels: () => [{ id: 'ollama:voice-model', label: 'Voice model' }],
}))
vi.mock('@/packages/local-speech/store', () => ({
  useLocalSpeech: () => ({ engineId: 'built-in', status: 'unsupported', voices: [] }),
  selectVoice: () => undefined,
}))
vi.mock('@/packages/local-speech/usePlayback', () => ({ usePlayback: () => ({ available: false, playing: false }) }))
vi.mock('@/packages/local-speech/useDictationAvailability', () => ({
  useDictationAvailability: () => ({ kind: 'ready', language: 'en-US' }),
  refreshDictationAvailability,
}))
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => undefined }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))

const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  if (scrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoView)
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

test('opens the built-in recognition selector independently of playback engines', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  render(
    <MantineProvider>
      <LocalSpeechSettings />
    </MantineProvider>
  )

  const recognitionCard = within(screen.getByRole('group', { name: 'Speech recognition' }))
  const synthesisCard = within(screen.getByRole('group', { name: 'Speech synthesis' }))
  const recognition = recognitionCard.getByRole('textbox', { name: 'Speech recognition' })
  expect(recognition).toHaveProperty('value', 'Built-in')
  fireEvent.click(recognition)
  const options = within(await screen.findByRole('listbox')).getAllByRole('option')
  expect(options.map((option) => option.textContent)).toEqual(['Built-in'])
  fireEvent.click(options[0])
  expect(recognition).toHaveProperty('value', 'Built-in')

  fireEvent.click(synthesisCard.getByRole('textbox', { name: 'Speech engine' }))
  const playback = await screen.findByRole('listbox', { name: 'Speech engine' })
  expect(within(playback).getByRole('option', { name: 'Voice model' })).toBeTruthy()
  expect(recognitionCard.getByRole('status').textContent).toBe('Voice input language: en-US')
  expect(synthesisCard.getByRole('button', { name: 'Model Provider' })).toBeTruthy()
  fireEvent.click(recognitionCard.getByRole('button', { name: 'Refresh' }))
  expect(refreshDictationAvailability).toHaveBeenCalledOnce()
})
