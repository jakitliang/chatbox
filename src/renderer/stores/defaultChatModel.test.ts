import { describe, expect, it } from 'vitest'
import { applyChatboxLicenseDefaultModelToSession, resolveChatboxLicenseDefaultModel } from './defaultChatModel'

describe('self-host chat defaults', () => {
  const licensed = { licenseKey: 'old-key', licenseDetail: { defaultModel: 'chatboxai-4', plan: 'pro' } }
  it('never selects a commercial model from imported account details', () => {
    expect(resolveChatboxLicenseDefaultModel(licensed)).toBeUndefined()
    expect(resolveChatboxLicenseDefaultModel({})).toBeUndefined()
  })
  it('keeps unset chats unset even when an old license exists', () => {
    const chat = { type: 'chat' as const, settings: { temperature: 0.7 } }
    expect(applyChatboxLicenseDefaultModelToSession(chat, licensed)).toBe(chat)
  })
})