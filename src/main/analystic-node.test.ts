import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getConfigMock, getVersionMock, ofetchMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  getVersionMock: vi.fn(),
  ofetchMock: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getVersion: getVersionMock,
  },
}))
vi.mock('ofetch', () => ({
  ofetch: ofetchMock,
}))
vi.mock('./store-node', () => ({
  getConfig: getConfigMock,
}))

import { event } from './analystic-node'

describe('main-process analytics', () => {
  beforeEach(() => {
    getConfigMock.mockReset()
    getVersionMock.mockReset()
    ofetchMock.mockReset()
    getConfigMock.mockReturnValue({ uuid: 'installation-uuid' })
    getVersionMock.mockReturnValue('1.2.3')
    ofetchMock.mockResolvedValue(undefined)
  })

  it('does not read installation identifiers or send events', async () => {
    expect(await event('app_open', { session_id: 123 })).toBeNull()
    expect(await event('app_open')).toBeNull()
    expect(getConfigMock).not.toHaveBeenCalled()
    expect(getVersionMock).not.toHaveBeenCalled()
    expect(ofetchMock).not.toHaveBeenCalled()
  })

  it('does not inspect event properties', async () => {
    const params = new Proxy({}, { get() { throw new Error('must not read event data') } })
    expect(await event('app_open', params)).toBeNull()
    expect(ofetchMock).not.toHaveBeenCalled()
  })
})
