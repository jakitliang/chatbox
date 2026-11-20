// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import LocalSpeechSettings from './LocalSpeechSettings'

const speech = vi.hoisted(() => ({
  hasVoice: false,
  voice: { id: 'local', name: 'Local test voice', lang: 'en-US' },
  refresh: vi.fn(),
  toggle: vi.fn(),
}))
vi.mock('@tanstack/react-router', async () => {
  const { forwardRef } = await import('react')
  return {
    Link: forwardRef<HTMLAnchorElement, React.ComponentPropsWithoutRef<'a'> & { to: string }>(
      ({ to, ...props }, ref) => <a {...props} href={to} ref={ref} />
    ),
  }
})
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US' },
  }),
}))
vi.mock('@/packages/local-speech/playback-backends', () => ({
  builtInPlaybackId: 'built-in',
  speechProviderId: 'ollama',
  listSpeechModels: () => [{ id: 'ollama:voice-model', label: 'Voice model' }],
}))
vi.mock('@/packages/local-speech/store', () => ({
  useLocalSpeech: () => ({
    engineId: 'built-in',
    status: speech.hasVoice ? 'ready' : 'unsupported',
    voices: speech.hasVoice ? [speech.voice] : [],
  }),
  selectVoice: () => (speech.hasVoice ? speech.voice : undefined),
  refreshLocalSpeech: speech.refresh,
}))
vi.mock('@/packages/local-speech/usePlayback', () => ({
  usePlayback: () => ({ available: speech.hasVoice, playing: false, toggle: speech.toggle }),
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

beforeEach(() => {
  speech.hasVoice = false
  vi.clearAllMocks()
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
})

test('shows only synthesis settings with built-in and Ollama playback options', async () => {
  render(
    <MantineProvider>
      <LocalSpeechSettings />
    </MantineProvider>
  )

  expect(screen.queryByRole('group', { name: 'Speech recognition' })).toBeNull()
  const card = screen.getByRole('group', { name: 'Speech synthesis' })
  for (const text of ['Speech synthesis', 'Read replies aloud.']) {
    const header = screen.getByText(text, { exact: true })
    expect(card.contains(header)).toBe(false)
    expect(header.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }
  const synthesisCard = within(card)
  const engine = synthesisCard.getByRole('textbox', { name: 'Speech engine' })
  expect(engine).toHaveProperty('value', 'Built-in')
  fireEvent.click(engine)
  const playback = await screen.findByRole('listbox', { name: 'Speech engine' })
  expect(within(playback).getByRole('option', { name: 'Voice model' })).toBeTruthy()
  expect(synthesisCard.getByRole('link', { name: 'Model Provider' }).getAttribute('href')).toBe('/settings/provider')
})

test('puts voice actions beside the selector with the default-model action style', () => {
  speech.hasVoice = true
  render(
    <MantineProvider>
      <LocalSpeechSettings />
    </MantineProvider>
  )

  const synthesis = within(screen.getByRole('group', { name: 'Speech synthesis' }))
  const voice = synthesis.getByRole('textbox', { name: 'Local voice' })
  const refresh = synthesis.getByRole('button', { name: 'Refresh' })
  const preview = synthesis.getByRole('button', { name: 'Preview voice' })
  expect(voice.closest('.mantine-Flex-root')).toBe(refresh.parentElement?.parentElement)
  expect(refresh.parentElement).toBe(preview.parentElement)
  expect(refresh.getAttribute('data-variant')).toBe('default')
  expect(preview.getAttribute('data-variant')).toBe('default')
  expect(refresh.getAttribute('data-size')).toBe('sm')
  expect(preview.getAttribute('data-size')).toBe('sm')
  const providerLink = synthesis.getByRole('link', { name: 'Model Provider' })
  expect(providerLink.getAttribute('data-variant')).toBe('subtle')
  expect(providerLink.getAttribute('data-size')).toBe('compact-xs')
  fireEvent.click(refresh)
  fireEvent.click(preview)
  expect(speech.refresh).toHaveBeenCalledOnce()
  expect(speech.toggle).toHaveBeenCalledOnce()
})
