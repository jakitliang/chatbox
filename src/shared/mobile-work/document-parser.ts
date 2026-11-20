export interface ParsedLocalDocument {
  text: string
  truncated: boolean
}

export interface WorkDocumentParser {
  formats: readonly string[]
  parse(name: string, base64: string, signal: AbortSignal): Promise<ParsedLocalDocument>
}

export const LOCAL_OFFICE_FORMATS = ['.docx', '.xlsx', '.pptx']

type WorkInput = { name: string; base64: string }

export function createWorkDocumentParser(
  formats: readonly string[],
  execute: WorkDocumentParser['parse']
): WorkDocumentParser {
  return {
    formats,
    async parse(name, base64, signal) {
      const input: WorkInput = { name, base64 }
      const parser = selectDocumentParser<WorkInput>(
        {
          local: () => ({
            id: 'local',
            supports: ({ name }) => formats.some((extension) => name.toLowerCase().endsWith(extension)),
            parse: (document) => execute(document.name, document.base64, signal),
          }),
        },
        'local',
        input
      )
      const result = await parseDocument(parser, input, signal)
      return { text: result.text, truncated: result.truncated ?? false }
    },
  }
}

export const WORK_DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']

export function isWorkDocument(name: string): boolean {
  return WORK_DOCUMENT_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension))
}

export function isLocalDocument(name: string): boolean {
  return LOCAL_OFFICE_FORMATS.some((extension) => name.toLowerCase().endsWith(extension))
}

export const MAX_PARSED_DOCUMENT_TEXT = 100_000
import { parseDocument, selectDocumentParser } from '../document-parsing'
