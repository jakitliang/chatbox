import type { SessionHeader } from '@shared/types'

// Legacy stored account data must never select a commercial provider.
export type ChatboxDefaultModelSettings = {
  licenseKey?: string
  hasExpiredLicense?: boolean
  licenseDetail?: unknown
  licensePlanName?: string
}

export type DefaultChatModelSelection = { provider: string; modelId: string }

export function resolveChatboxLicenseDefaultModel(
  _settings: ChatboxDefaultModelSettings
): DefaultChatModelSelection | undefined {
  return undefined
}

export function applyChatboxLicenseDefaultModelToSession<T extends Pick<SessionHeader, 'type' | 'settings'>>(
  session: T,
  _settings: ChatboxDefaultModelSettings
): T {
  return session
}