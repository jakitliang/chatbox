import { ChatboxAIAPIError } from '@shared/models/errors'
import { describe, expect, it } from 'vitest'
import { ChatboxAIErrorMessage, getLocalErrorI18nKey } from './ChatboxAIErrorMessage'

describe('local legacy error guidance', () => {
  it('keeps useful noncommercial error details', () => {
    const detail = ChatboxAIAPIError.codeNameMap.model_not_support_tool_use
    expect(getLocalErrorI18nKey(detail)).toBe(detail.i18nKey)
    expect(getLocalErrorI18nKey(ChatboxAIAPIError.codeNameMap.file_too_large)).toContain('50MB')
  })

  it('removes commercial instructions from every known legacy error', () => {
    for (const detail of Object.values(ChatboxAIAPIError.codeNameMap)) {
      expect(getLocalErrorI18nKey(detail)).not.toMatch(
        /Chatbox AI|Chatbox Desktop|OpenMorePlanButton|LinkToHomePage|LinkToAdvanced|license|subscription|chatboxai|upgrade/i
      )
    }
  })

  it('routes file and search failures to their local configuration', () => {
    expect(getLocalErrorI18nKey(ChatboxAIAPIError.codeNameMap.chatbox_ai_parser_license_key_required)).toContain(
      '<OpenDocumentParserSettingButton>document parser settings</OpenDocumentParserSettingButton>'
    )
    expect(getLocalErrorI18nKey(ChatboxAIAPIError.codeNameMap.model_not_support_web_browsing)).toContain(
      '<OpenExtensionSettingButton>search provider settings</OpenExtensionSettingButton>'
    )
    expect(getLocalErrorI18nKey(ChatboxAIAPIError.codeNameMap.license_upgrade_required)).toContain(
      '<OpenSettingButton>provider settings</OpenSettingButton>'
    )
  })

  it('preserves the unknown-code fallback', () => {
    expect(ChatboxAIErrorMessage({ errorCode: -1 })).toBeNull()
  })
})