import type { Config, CopilotDetail, Settings } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as licensing from './lemonsqueezy'
import * as remote from './remote'

const { request, backend } = vi.hoisted(() => ({
  request: vi.fn(),
  backend: { origin: 'http://127.0.0.1:4567' },
}))
vi.mock('ofetch', () => ({ ofetch: request }))
vi.mock('@shared/request/chatboxai_pool', () => ({ getChatboxAPIOrigin: () => backend.origin }))
// Importing the remote module must never initialize the old authenticated/platform clients.
vi.mock('@shared/request/request', () => { throw new Error('Legacy transport imported') })
vi.mock('@/platform', () => { throw new Error('Platform metadata imported') })
vi.mock('@/stores/authInfoStore', () => { throw new Error('Account tokens imported') })

beforeEach(() => {
  request.mockReset()
  backend.origin = 'http://127.0.0.1:4567'
  remote.invalidateSessionRagConfigCache()
})

describe('self-host backend reads', () => {
  it('resolves API and website helpers dynamically', () => {
    expect(remote.getAPIOrigin()).toBe(backend.origin)
    expect(remote.getChatboxOrigin()).toBe(backend.origin)
    expect(remote.buildChatboxUrl('/help?lang=en')).toBe(`${backend.origin}/help?lang=en`)
    backend.origin = 'https://selfhost.example'
    expect(remote.getAPIOrigin()).toBe(backend.origin)
    expect(remote.getChatboxOrigin()).toBe(backend.origin)
    expect(remote.buildChatboxUrl('help')).toBe(`${backend.origin}/help`)
  })

  it('reads remote config without device headers', async () => {
    request.mockResolvedValue({ data: { product_ids: [] } })
    expect(await remote.getRemoteConfig('product_ids')).toEqual({ product_ids: [] })
    expect(request).toHaveBeenCalledWith(`${backend.origin}/api/remote_config/product_ids`, { retry: 3 })
  })

  it('reads tags and the cursor list, preserving absolute backend assets', async () => {
    request.mockResolvedValueOnce({ data: ['Writing'] })
    expect(await remote.listCopilotTags('en/US')).toEqual(['Writing'])
    expect(request).toHaveBeenLastCalledWith(`${backend.origin}/api/system_copilots/tags/en%2FUS`, {
      method: 'GET', retry: 3,
    })
    const data = [{ id: 'local', picUrl: `${backend.origin}/avatars/a.png`, avatar: { type: 'url', url: `${backend.origin}/avatars/a.png` } }]
    request.mockResolvedValueOnce({ data, next_cursor: 'next' })
    expect(await remote.listCopilotsByCursor('en', { limit: 2, cursor: 'cursor', tag: 'Writing', search: 'local' }))
      .toEqual({ data, next_cursor: 'next' })
    expect(request).toHaveBeenLastCalledWith(`${backend.origin}/api/system_copilots/list`, {
      method: 'POST', retry: 3,
      body: { lang: 'en', limit: 2, cursor: 'cursor', tag: 'Writing', search: 'local' },
    })
  })

  it('uses the models envelope, filters incompatible entries and never sends a license', async () => {
    const model = { modelId: 'local-chat', modelName: 'Local Chat', apiStyle: 'openai-responses' }
    const image = { modelId: 'local-image', modelName: 'Local Image', type: 'image' }
    request.mockResolvedValue({ data: {
      groupName: 'Local models', models: [model, null, { modelId: 'invalid' }, { ...model, apiStyle: 'future' }],
      imageModels: [image, { ...image, capabilities: ['future'] }],
    } })
    expect(await remote.getModelManifest({ aiProvider: 'openai', licenseKey: 'old-license', language: 'en' }))
      .toEqual({ groupName: 'Local models', models: [model], imageModels: [image] })
    expect(request).toHaveBeenCalledWith(`${backend.origin}/api/model_manifest`, {
      method: 'POST', retry: 2, body: { aiProvider: 'openai' },
    })
    backend.origin = 'http://localhost:9876'
    await remote.getModelManifest({ aiProvider: 'gemini' })
    expect(request.mock.lastCall?.[0]).toBe(`${backend.origin}/api/model_manifest`)
  })

  it('supports empty catalogs and rejects malformed collection envelopes', async () => {
    request.mockResolvedValue({ data: { groupName: 'Local models', models: [] } })
    expect(await remote.getModelManifest({ aiProvider: 'openai' })).toEqual({ groupName: 'Local models', models: [], imageModels: [] })
    request.mockResolvedValue({ data: { groupName: 'Local models', models: {} } })
    await expect(remote.getModelManifest({ aiProvider: 'openai' })).rejects.toThrow()
    request.mockResolvedValue({ models: [] })
    await expect(remote.getModelManifest({ aiProvider: 'openai' })).rejects.toThrow()
  })
})

describe('origin-scoped session RAG cache', () => {
  it('shares concurrent reads and ignores old license keys', async () => {
    const data = { models: [], capabilities: {} }
    request.mockResolvedValue({ data })
    expect(await Promise.all([
      remote.getSessionRagConfig({ licenseKey: 'secret-one' }),
      remote.getSessionRagConfig({ licenseKey: 'secret-two' }),
    ])).toEqual([data, data])
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(`${backend.origin}/api/session_rag/config`, { retry: 3 })
  })

  it('separates origins while preserving the prior backend cache', async () => {
    request.mockResolvedValueOnce({ data: { models: ['first'] } })
    expect(await remote.getSessionRagConfig()).toEqual({ models: ['first'] })
    backend.origin = 'http://localhost:9876'
    request.mockResolvedValueOnce({ data: { models: ['second'] } })
    expect(await remote.getSessionRagConfig()).toEqual({ models: ['second'] })
    backend.origin = 'http://127.0.0.1:4567'
    expect(await remote.getSessionRagConfig()).toEqual({ models: ['first'] })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('captures the origin for pending requests across settings changes', async () => {
    let finish: ((value: unknown) => void) | undefined
    request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const first = remote.getSessionRagConfig()
    backend.origin = 'http://localhost:9876'
    request.mockResolvedValueOnce({ data: { models: ['second'] } })
    expect(await remote.getSessionRagConfig()).toEqual({ models: ['second'] })
    finish?.({ data: { models: ['first'] } })
    expect(await first).toEqual({ models: ['first'] })
    expect(await remote.getSessionRagConfig()).toEqual({ models: ['second'] })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('evicts failures, expires after ten minutes and supports legacy invalidation', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0)
    try {
      request.mockRejectedValueOnce(new Error('offline'))
      await expect(remote.getSessionRagConfig()).rejects.toThrow('offline')
      request.mockResolvedValue({ data: { models: [] } })
      await remote.getSessionRagConfig()
      await remote.getSessionRagConfig()
      expect(request).toHaveBeenCalledTimes(2)
      clock.mockReturnValue(10 * 60 * 1000)
      await remote.getSessionRagConfig()
      expect(request).toHaveBeenCalledTimes(3)
      remote.invalidateSessionRagConfigCache('ignored-license')
      await remote.getSessionRagConfig()
      expect(request).toHaveBeenCalledTimes(4)
    } finally { clock.mockRestore() }
  })
})

describe('inert business compatibility', () => {
  it('returns empty reads without requesting official catalogs, licenses or updates', async () => {
    expect(await remote.getChatboxAIModelList({ licenseKey: 'secret' })).toMatchObject({
      groups: [], models: {}, imageModels: [], license: { plan: 'unknown' },
    })
    expect(await remote.getLicenseDetail({ licenseKey: 'secret' })).toBeNull()
    expect(await remote.getLicenseDetailRealtime({ licenseKey: 'secret' })).toEqual({ data: null })
    expect(await remote.getLicenseDetailForInspection({ licenseKey: 'secret' })).toEqual({ data: null })
    expect(await remote.listLicensesByUser()).toEqual([])
    expect(await remote.getProviderModelsInfo({ modelIds: ['local'] })).toEqual({})
    expect(await remote.checkNeedUpdate('1', 'linux', {} as Config, {} as Settings)).toBe(false)
    expect(await remote.getDialogConfig({ uuid: 'secret', language: 'en', version: '1' })).toBeNull()
    expect(request).not.toHaveBeenCalled()
  })

  const operations: Array<[string, () => Promise<unknown>]> = [
    ['activate', () => remote.activateLicense({ licenseKey: 'secret', instanceName: 'device' })],
    ['deactivate', () => remote.deactivateLicense({ licenseKey: 'secret', instanceId: 'device' })],
    ['validate', () => remote.validateLicense({ licenseKey: 'secret', instanceId: 'device' })],
    ['upload URL', () => remote.generateUploadUrl({ licenseKey: 'secret', filename: 'private.txt' })],
    ['create file', () => remote.createUserFile({ licenseKey: 'secret', filename: 'private.txt', filetype: 'text/plain', returnContent: true })],
    ['parse file', () => remote.uploadAndParseUserFile('secret', {} as File, new AbortController().signal)],
    ['upload file', () => remote.uploadAndCreateUserFile('secret', {} as File)],
    ['parse link', () => remote.parseUserLinkPro({ licenseKey: 'secret', url: 'https://private.example' })],
    ['proxy', () => remote.parseUserLinkFree({ url: 'https://private.example' })],
    ['search', () => remote.getChatboxWebSearchRequestOptions()],
    ['login ticket', () => remote.requestLoginTicketId()],
    ['email code', () => remote.sendEmailLoginCode({ email: 'private@example.test' })],
    ['signup', () => remote.loginOrSignupWithEmailCode({ email: 'private@example.test', code: 'secret' })],
    ['web auth', () => remote.getWebAuthToken()],
    ['login status', () => remote.checkLoginStatus('secret')],
    ['refresh token', () => remote.refreshAccessToken({ refreshToken: 'secret' })],
    ['profile', () => remote.getUserProfile()],
    ['publishing', () => remote.issueVibedropKey()],
    ['reward', () => remote.claimFreeAgentModeReward('secret')],
    ['pricing', () => remote.getPremiumPrice()],
    ['usage', () => remote.recordCopilotUsage({ id: 'private', action: 'use_copilot' })],
    ['share', () => remote.recordCopilotShare({} as CopilotDetail)],
    ['report', () => remote.reportContent({ id: 'private', type: 'message', details: 'private content' })],
    ['submit image', () => remote.submitImageGeneration({} as remote.ImageCompletionRequest, 'secret')],
    ['poll image', () => remote.pollImageTask('private', 'secret')],
    ['wait image', () => remote.pollTaskUntilComplete('private', 'secret')],
    ['vendor activate', () => licensing.activateLicense('secret', 'device')],
    ['vendor deactivate', () => licensing.deactivateLicense('secret', 'device')],
    ['vendor validate', () => licensing.validateLicense('secret', 'device')],
  ]
  it.each(operations)('%s fails explicitly without network or payload serialization', async (_name, run) => {
    await expect(run()).rejects.toMatchObject({ name: 'LocalUnavailableError', code: 'local_unavailable' })
    expect(request).not.toHaveBeenCalled()
  })

  it('does not inspect or serialize private business arguments', async () => {
    const privatePayload = new Proxy({} as CopilotDetail, { get() { throw new Error('Private payload inspected') } })
    await expect(remote.recordCopilotShare(privatePayload)).rejects.toBeInstanceOf(remote.LocalUnavailableError)
    expect(request).not.toHaveBeenCalled()
  })
})
