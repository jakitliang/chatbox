import { Link } from '@mui/material'
import { ChatboxAIAPIError } from '@shared/models/errors'
import type { CSSProperties, FC } from 'react'
import { Trans } from 'react-i18next'
import { navigateToSettings } from '@/modals/settings-navigation'

interface ChatboxAIErrorMessageProps {
  errorCode: number
  /** Optional model name for `{{model}}` interpolation in i18n keys. */
  model?: string
  /** Legacy compatibility prop; no tracking or commercial actions. */
  trackingSource?: string
  linkStyle?: CSSProperties
}

const SUPPORTED_WEB_BROWSING_MODELS = 'gemini-2.0-flash(API), perplexity API'

/** Keep useful provider errors, but never render legacy sales or account instructions. */
export function getLocalErrorI18nKey(detail: { name: string; i18nKey: string }): string {
  if (
    !/Chatbox AI|Chatbox Desktop|OpenMorePlanButton|LinkToHomePage|LinkToAdvanced|license|subscription|chatboxai|upgrad/i.test(
      detail.i18nKey
    )
  ) {
    return detail.i18nKey
  }
  if (/parser|file|parsing/.test(detail.name)) {
    return 'File processing failed. Try a smaller supported file or check your <OpenDocumentParserSettingButton>document parser settings</OpenDocumentParserSettingButton> and self-host server configuration.'
  }
  if (/search|web_browsing/.test(detail.name)) {
    return 'Web search is unavailable. Check your <OpenExtensionSettingButton>search provider settings</OpenExtensionSettingButton> or select a compatible model.'
  }
  return 'The configured provider could not complete the request. Check your <OpenSettingButton>provider settings</OpenSettingButton>, select a compatible model, or contact your self-host administrator.'
}

/**
 * Renders a localized message for a known legacy error code with local settings
 * actions only. Returns `null`
 * for unknown codes so callers can fall back to a generic message.
 */
export const ChatboxAIErrorMessage: FC<ChatboxAIErrorMessageProps> = ({
  errorCode,
  model,
  linkStyle,
}) => {
  const detail = ChatboxAIAPIError.getDetail(errorCode)
  if (!detail) return null

  return (
    <Trans
      i18nKey={getLocalErrorI18nKey(detail)}
      values={{
        model,
        supported_web_browsing_models: SUPPORTED_WEB_BROWSING_MODELS,
      }}
      components={{
        OpenSettingButton: (
          <Link
            component="button"
            type="button"
            className={linkStyle ? 'cursor-pointer' : 'cursor-pointer italic'}
            style={linkStyle}
            onClick={() => {
              navigateToSettings('/provider')
            }}
          />
        ),
        OpenExtensionSettingButton: (
          <Link
            component="button"
            type="button"
            className={linkStyle ? 'cursor-pointer' : 'cursor-pointer italic'}
            style={linkStyle}
            onClick={() => {
              navigateToSettings('/web-search')
            }}
          />
        ),
        OpenDocumentParserSettingButton: (
          <Link
            component="button"
            type="button"
            className={linkStyle ? 'cursor-pointer' : 'cursor-pointer italic'}
            style={linkStyle}
            onClick={() => {
              navigateToSettings('/document-parser')
            }}
          />
        ),
      }}
    />
  )
}
