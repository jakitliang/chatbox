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

describe('local-only catalogs and configuration', () => {
  it('resolves only the selected backend and disables retired website links', () => {
    expect(remote.getAPIOrigin()).toBe(backend.origin)
    expect(remote.buildChatboxUrl('/help')).toBe('about:blank')
    backend.origin = 'https://selfhost.example'
    expect(remote.getAPIOrigin()).toBe(backend.origin)
    expect(remote.buildChatboxUrl('/purchase')).toBe('about:blank')
  })
  it('loads bundled catalogs and configuration without backend calls', async () => {
    const config = await remote.getRemoteConfig('product_ids')
    expect(config).toHaveProperty('product_ids')
    const tags = await remote.listCopilotTags('en')
    expect(Array.isArray(tags)).toBe(true)
    const page = await remote.listCopilotsByCursor('en', { limit: 2 })
    expect(page.data.length).toBeLessThanOrEqual(2)
    expect(await remote.getModelManifest({ aiProvider: 'openai', licenseKey: 'secret' })).toHaveProperty('models')
    expect(request).not.toHaveBeenCalled()
  })
  it('keeps local RAG configuration independent of licenses and backend origin', async () => {
    const first = await remote.getSessionRagConfig({ licenseKey: 'secret' })
    backend.origin = 'https://another.example'
    remote.invalidateSessionRagConfigCache('secret')
    expect(await remote.getSessionRagConfig()).toEqual(first)
    expect(request).not.toHaveBeenCalled()
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
