import { CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR } from '@shared/file-parse-errors'
import {
  KNOWLEDGE_BASE_MAX_PARSED_CONTENT_SIZE_LABEL,
  KNOWLEDGE_BASE_PARSED_CONTENT_TOO_LARGE_ERROR,
} from '@shared/knowledge-base'
import { ChatboxAIAPIError } from '@shared/models/errors'
import type { KnowledgeBaseFile } from '@shared/types'
import { getChatboxAIParserAccountErrorLabel } from '@/utils/file-parse-error'

type KnowledgeBaseFileRetryState = Pick<KnowledgeBaseFile, 'error' | 'parsed_remotely'>
type ErrorTranslationOptions = { limit: string }
type ErrorTranslator = (key: string, options?: ErrorTranslationOptions) => string

export function isChatboxAIParserLicenseRequired(error: string | undefined): boolean {
  return error === CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR
}

export function getKnowledgeBaseFileErrorStatusLabel(
  error: string | undefined,
  t: (key: string) => string
): string | undefined {
  return isChatboxAIParserLicenseRequired(error) ? t('Sign in needed') : getChatboxAIParserAccountErrorLabel(error, t)
}

export function canRetryKnowledgeBaseFileWithServer(_file: KnowledgeBaseFileRetryState): boolean {
  // The automatic official cloud parser has been removed. Normal retries still use the configured parser.
  return false
}

// Tooltips are plain text, so drop the Trans component tags from Chatbox AI error keys.
function translateChatboxAIError(errorCode: string, t: ErrorTranslator): string {
  return t(ChatboxAIAPIError.codeNameMap[errorCode].i18nKey).replace(/<[^>]*>/g, '')
}

export function getKnowledgeBaseFileErrorLabel(errorMessage: string, t: ErrorTranslator): string {
  if (errorMessage === KNOWLEDGE_BASE_PARSED_CONTENT_TOO_LARGE_ERROR) {
    return t('Parsed document content must be {{limit}} or smaller.', {
      limit: KNOWLEDGE_BASE_MAX_PARSED_CONTENT_SIZE_LABEL,
    })
  }

  if (ChatboxAIAPIError.codeNameMap[errorMessage]) {
    return translateChatboxAIError(errorMessage, t)
  }

  try {
    const jsonMatch = errorMessage.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      const errorCode = parsed.error?.code

      if (errorCode && ChatboxAIAPIError.codeNameMap[errorCode]) {
        return translateChatboxAIError(errorCode, t)
      }
      if (parsed.error?.detail) {
        return parsed.error.detail
      }
      if (parsed.error?.title) {
        return parsed.error.title
      }
    }
  } catch {
    // Render the original message when the response is not valid JSON.
  }
  return t(errorMessage)
}

/** Account failures show what to fix, matching their status label; others explain the failure. */
export function getKnowledgeBaseFileErrorTooltip(error: string, t: ErrorTranslator): string {
  return getKnowledgeBaseFileErrorStatusLabel(error, t) ?? getKnowledgeBaseFileErrorLabel(error, t)
}
