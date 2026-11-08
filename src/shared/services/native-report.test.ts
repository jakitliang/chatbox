import { expect, it, vi } from 'vitest'
import { reportNativeContent } from './native-report'

it('rejects reports without sending message content', async () => {
  const fetchFn = vi.fn<typeof fetch>()
  await expect(reportNativeContent({ id: 'private', type: 'Other', details: '', fetchFn })).rejects.toThrow(
    'Chatbox AI content reporting is unavailable in the self-hosted edition'
  )
  expect(fetchFn).not.toHaveBeenCalled()
})
