/** Compatibility types for the retired hosted conversational guide. */

export interface GuideMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface GuideRequest {
  messages: GuideMessage[]
  device_id: string
  onboarding_step?: 'greeting' | 'selection' | 'login_flow' | 'completed'
  is_logged_in?: boolean
  stream: boolean
}

/** Old callers fail locally instead of contacting a hosted onboarding service. */
export async function sendGuideMessage(
  _messages: GuideMessage[],
  _deviceId: string,
  _options?: {
    onboardingStep?: GuideRequest['onboarding_step']
    isLoggedIn?: boolean
    signal?: AbortSignal
  }
): Promise<Response> {
  throw new Error('The hosted guide is unavailable. Configure your provider in Settings.')
}
