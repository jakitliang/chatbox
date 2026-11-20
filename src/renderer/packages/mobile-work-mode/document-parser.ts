import { DocumentParseError } from '@shared/document-parsing'
import {
  LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR,
  LOCAL_PARSER_FILE_TOO_LARGE_ERROR,
  NON_RECOVERABLE_LOCAL_PARSER_ERROR_CODES,
} from '@shared/file-parse-errors'
import { throwIfWorkAborted } from '@shared/mobile-work/abort'
import {
  isLocalDocument,
  isWorkDocument,
  createWorkDocumentParser,
  LOCAL_OFFICE_FORMATS,
  MAX_PARSED_DOCUMENT_TEXT,
  type ParsedLocalDocument,
  type WorkDocumentParser,
} from '@shared/mobile-work/document-parser'
import { MAX_WORKSPACE_FILE_BYTES } from '@shared/mobile-work/workspace-path'
import i18n from '@/i18n'
import { parsePdfFileLocally } from '@/packages/pdf-parser'
import { capacitorExecution } from './execution-service'

function boundText(text: string): ParsedLocalDocument {
  return { text: text.slice(0, MAX_PARSED_DOCUMENT_TEXT), truncated: text.length > MAX_PARSED_DOCUMENT_TEXT }
}

function fileSizeError(): Error {
  return new Error(String(i18n.t('Work Mode attachments must be {{limit}} or smaller.', { limit: '10 MB' })))
}

function workspacePdf(name: string, decoded: string): File {
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  const filename =
    name
      .replace(/^input\/[a-f0-9]{1,80}-/i, '')
      .split('/')
      .pop() ?? name
  return new File([bytes], filename, { type: 'application/pdf' })
}

const workParser = createWorkDocumentParser(['.pdf', ...LOCAL_OFFICE_FORMATS], async (name, base64, signal) => {
  const decoded = atob(base64)
  if (decoded.length > MAX_WORKSPACE_FILE_BYTES) throw new Error(LOCAL_PARSER_FILE_TOO_LARGE_ERROR)
  return isLocalDocument(name)
    ? capacitorExecution.parseDocument(name, base64, signal)
    : boundText(await parsePdfFileLocally(workspacePdf(name, decoded), { signal, failOnPageError: true }))
})

export const capacitorDocumentParser: WorkDocumentParser = {
  formats: workParser.formats,
  async parse(name, base64, signal) {
    throwIfWorkAborted(signal)
    try {
      return await workParser.parse(name, base64, signal)
    } catch (error) {
      throwIfWorkAborted(signal)
      if (error instanceof DocumentParseError) {
        if (error.code === 'empty') throw new Error(String(i18n.t('No readable text was found in this file.')))
        if (error.code === 'unsupported') {
          throw new Error(
            String(
              isWorkDocument(name)
                ? i18n.t('This format cannot be parsed locally. Convert it to PDF, DOCX, XLSX, or PPTX.')
                : i18n.t('Local document parsing supports PDF, DOCX, XLSX, and PPTX files.')
            )
          )
        }
      }
      if (error instanceof Error && NON_RECOVERABLE_LOCAL_PARSER_ERROR_CODES.has(error.message)) {
        if (error.message === LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR)
          throw new Error(
            String(
              i18n.t(
                'This PDF is password-protected, so its content cannot be read. Remove the password and upload it again.'
              )
            )
          )
        throw fileSizeError()
      }
      throw new Error(String(i18n.t('This file could not be parsed locally. Please try a different file format.')), {
        cause: error,
      })
    }
  },
}
