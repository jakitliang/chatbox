// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import DictationButton from '@/components/InputBox/DictationButton'
import { TooltipProvider } from '@/components/ui/tooltip'
import LocalSpeechSettings from './LocalSpeechSettings'

const refreshDictationAvailability = vi.hoisted(() => vi.fn())
const speech = vi.hoisted(() => ({
  hasVoice: false,
  voice: { id: 'local', name: 'Local test voice', lang: 'en-US' },
  refresh: vi.fn(),
  toggle: vi.fn(),
}))
const platform = vi.hoisted(() => ({ type: 'desktop' }))
vi.mock('@/platform', () => ({ default: platform }))
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

beforeEach(() => {
  platform.type = 'desktop'
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

test('opens the built-in recognition selector independently of playback engines', async () => {
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
  expect(synthesisCard.getByRole('link', { name: 'Model Provider' }).getAttribute('href')).toBe('/settings/provider')
  fireEvent.click(recognitionCard.getByRole('button', { name: 'Refresh' }))
  expect(refreshDictationAvailability).toHaveBeenCalledOnce()
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

test.each([
  ['web', false],
  ['desktop', true],
  ['mobile', true],
] as const)('shows dictation only on clients and keeps synthesis on %s', (type, showDictation) => {
  platform.type = type
  render(
    <MantineProvider>
      <LocalSpeechSettings />
      <TooltipProvider>
        <DictationButton
          disabled={false}
          dictation={{
            view: null,
            availability: { kind: 'ready', language: 'en-US' },
            toggle: vi.fn(async () => {}),
            cancel: vi.fn(),
            isActive: () => false,
          }}
        />
      </TooltipProvider>
    </MantineProvider>
  )

  expect(Boolean(screen.queryByRole('group', { name: 'Speech recognition' }))).toBe(showDictation)
  expect(Boolean(screen.queryByRole('button', { name: 'Start voice input' }))).toBe(showDictation)
  const synthesis = within(screen.getByRole('group', { name: 'Speech synthesis' }))
  expect(synthesis.getByRole('textbox', { name: 'Speech engine' })).toBeTruthy()
})
