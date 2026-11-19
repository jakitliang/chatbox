// @vitest-environment jsdom

import type { SessionSettings } from '@shared/types'
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useSessionContextWindowTier } from './useSessionContextWindowTier'

const updateSessionHeader = vi.hoisted(() => vi.fn())
vi.mock('@/app/renderer-application', () => ({ rendererApplication: { sessions: { updateSessionHeader } } }))

it('stores only the tier, restores it after remount and clears it on Default', async () => {
  let settings: SessionSettings = { maxTokens: 512 }
  updateSessionHeader.mockImplementation(
    async (_id: string, update: (header: { settings: SessionSettings }) => { settings: SessionSettings }) => {
      settings = update({ settings }).settings
    }
  )
  const first = renderHook(() => useSessionContextWindowTier('chat-a', settings.contextWindowTier))
  await act(() => first.result.current.changeTier('half'))
  expect(settings).toEqual({ contextWindowTier: 'half', maxTokens: 512 })
  expect(updateSessionHeader).toHaveBeenLastCalledWith('chat-a', expect.any(Function))
  first.unmount()

  const reopened = renderHook(
    ({ id }: { id: string }) =>
      useSessionContextWindowTier(id, id === 'chat-a' ? settings.contextWindowTier : undefined),
    { initialProps: { id: 'chat-a' } }
  )
  expect(reopened.result.current.tier).toBe('half')
  reopened.rerender({ id: 'chat-b' })
  expect(reopened.result.current.tier).toBe('default')
  reopened.rerender({ id: 'chat-a' })
  await act(() => reopened.result.current.changeTier('default'))
  expect(settings.contextWindowTier).toBeUndefined()
})

it('carries a new chat tier in its creation patch without updating an existing session', async () => {
  updateSessionHeader.mockClear()
  const draft = renderHook(() => useSessionContextWindowTier('new', undefined))
  await act(() => draft.result.current.changeTier('quarter'))
  expect(draft.result.current.draftPatch).toEqual({ contextWindowTier: 'quarter' })
  expect(updateSessionHeader).not.toHaveBeenCalled()
})
