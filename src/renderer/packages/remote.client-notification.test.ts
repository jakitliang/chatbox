import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn())
vi.mock('ofetch', () => ({ ofetch: request }))
vi.mock('@shared/request/chatboxai_pool', () => ({ getChatboxAPIOrigin: () => 'http://127.0.0.1:4567' }))

import { getNextClientNotification } from './remote'

describe('disabled client notifications', () => {
  beforeEach(() => request.mockReset())

  it('returns no notification and never transmits locale or batch history', async () => {
    await expect(getNextClientNotification({ locale: 'zh-Hant', displayed_batch_ids: ['private-history'] })).resolves.toBeNull()
    expect(request).not.toHaveBeenCalled()
  })

  it('does not inspect the former notification payload', async () => {
    const params = new Proxy({ locale: 'en', displayed_batch_ids: [] }, {
      get() { throw new Error('Notification history inspected') },
    })
    await expect(getNextClientNotification(params)).resolves.toBeNull()
    expect(request).not.toHaveBeenCalled()
  })
})
