// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { DictationUpdate } from '@/packages/local-speech/contracts'
import { useComposerDictation } from './useComposerDictation'

const start = vi.hoisted(() => vi.fn())
vi.mock('@/packages/local-speech/built-in', () => ({ getBuiltInSpeech: () => ({ dictation: { start } }) }))
vi.mock('@/packages/local-speech/useDictationAvailability', () => ({
  useDictationAvailability: () => ({ kind: 'ready', language: 'en-US' }),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function fakeSession() {
  const completion = deferred<string>()
  const session = { result: completion.promise, stop: vi.fn(), cancel: vi.fn() }
  let update: (progress: DictationUpdate) => void = () => {}
  start.mockImplementationOnce((_language: string, callback: typeof update) => {
    update = callback
    return session
  })
  return { ...completion, session, deliver: (progress: DictationUpdate) => update(progress) }
}

test('Stop accepts confirmed results while keeping submit blocked through draft commit', async () => {
  const backend = fakeSession()
  const committed = deferred<void>()
  const onTranscript = vi.fn(() => committed.promise)
  const { result } = renderHook(() => useComposerDictation('chat', false, onTranscript))
  act(() => {
    void result.current.toggle()
    backend.deliver({ confirmed: 'one', interim: 'two?' })
  })
  expect(result.current.view).toEqual({ confirmed: 'one', interim: 'two?', stopping: false })
  expect(result.current.isActive()).toBe(true)
  act(() => {
    void result.current.toggle()
    backend.deliver({ confirmed: 'one two', interim: 'three?' })
  })
  expect(backend.session.stop).toHaveBeenCalledOnce()
  expect(result.current.view).toEqual({ confirmed: 'one two', interim: '', stopping: true })
  await act(async () => backend.resolve('one two'))
  expect(onTranscript).toHaveBeenCalledExactlyOnceWith('one two', expect.any(AbortSignal))
  expect(result.current.isActive()).toBe(true)
  await act(async () => committed.resolve())
  expect(result.current.isActive()).toBe(false)
  expect(result.current.view).toBeNull()
})

test.each(['cancel', 'switch'])('ignores a previous capture after %s', async (action) => {
  const backend = fakeSession()
  const onTranscript = vi.fn()
  const { result, rerender } = renderHook(({ thread }) => useComposerDictation(thread, false, onTranscript), {
    initialProps: { thread: 'first' },
  })
  act(() => {
    void result.current.toggle()
    backend.deliver({ confirmed: 'one', interim: '' })
  })
  if (action === 'cancel') act(() => result.current.cancel())
  else rerender({ thread: 'second' })

  await act(async () => {
    backend.deliver({ confirmed: 'late result', interim: '' })
    backend.resolve('late result')
  })
  expect(backend.session.cancel).toHaveBeenCalledOnce()
  expect(result.current.view).toBeNull()
  expect(onTranscript).not.toHaveBeenCalled()
})
