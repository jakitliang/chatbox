import { describe, expect, it, vi } from 'vitest'
import { ChatboxAISettings } from '@/routes/settings/provider/chatbox-ai/-components/ChatboxAISettings'
import { EmailCodeLoginModal } from '@/routes/settings/provider/chatbox-ai/-components/EmailCodeLoginModal'
import {
  MobileWebDownloadBanner,
  SidebarDesktopDownloadCard,
  useWebAppDownloadPromptVisible,
} from './DesktopDownloadReminder'

describe('inert commercial UI compatibility', () => {
  it('never displays official app download prompts', () => {
    expect(useWebAppDownloadPromptVisible()).toBe(false)
    expect(SidebarDesktopDownloadCard()).toBeNull()
    expect(MobileWebDownloadBanner()).toBeNull()
  })

  it('does not render login UI or call legacy callbacks even when opened', () => {
    const onClose = vi.fn()
    const onLoginSuccess = vi.fn(async () => undefined)
    expect(EmailCodeLoginModal({ opened: true, language: 'en', onClose, onLoginSuccess })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(onLoginSuccess).not.toHaveBeenCalled()
  })

  it('redirects legacy commercial settings to configured providers', () => {
    expect(ChatboxAISettings({ padded: true }).props.to).toBe('/settings/provider')
  })
})