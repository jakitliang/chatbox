import { DocumentParseError, type ParserId, type ParserRegistry } from '@shared/document-parsing'
import type { DocumentParserConfig } from '@shared/types/settings'
import type { Platform } from '@/platform/interfaces'
import storage from '@/storage'

export const documentParsers = {
  local: {
    label: 'Local',
    description: 'Uses built-in document parsing, with no automatic fallback to cloud parsing.',
  },
  mineru: {
    label: 'MinerU',
    description: 'Third-party cloud parsing service, supports PDF and most Office files. Requires API token.',
  },
} as const

export type ActiveDocumentParser = ParserId

export function isActiveDocumentParser(type: string | null | undefined): type is ActiveDocumentParser {
  return typeof type === 'string' && Object.hasOwn(documentParsers, type)
}

type ParserHost = Pick<Platform, 'parseFileLocally' | 'supportsLocalDocument' | 'parseFileWithMineru'>

export function createAttachmentParsers(
  host: ParserHost,
  config: DocumentParserConfig,
  blobs: { getBlob(key: string): Promise<string | null | undefined>; delBlob(key: string): Promise<unknown> } = storage
): ParserRegistry<File> {
  const parsers: ParserRegistry<File> = {
    local: () => ({
      id: 'local',
      supports: (file) => host.supportsLocalDocument?.(file) ?? true,
      async parse(file) {
        const result = await host.parseFileLocally(file)
        if (result.errorCode) throw new Error(result.errorCode)
        if (!result.isSupported) throw new DocumentParseError('unsupported')
        if (!result.key) throw new Error('local_parser_failed')
        try {
          return { text: (await blobs.getBlob(result.key)) ?? '' }
        } finally {
          await blobs.delBlob(result.key).catch(() => undefined)
        }
      },
    }),
  }
  const parseMineru = host.parseFileWithMineru?.bind(host)
  if (parseMineru) {
    parsers.mineru = () => ({
      id: 'mineru',
      supports: () => true, // Supported upload formats are validated by the service.
      async parse(file) {
        const token = config.mineru?.apiToken
        if (!token) throw new Error('mineru_api_token_required')
        const result = await parseMineru(file, token)
        if (result.cancelled) throw new Error('parsing_cancelled')
        if (!result.success) throw new Error('third_party_parser_failed')
        return { text: result.content ?? '' }
      },
    })
  }
  return parsers
}

export function getAvailableDocumentParsers(host: ParserHost): ActiveDocumentParser[] {
  // Listing factories does not instantiate a parser or need credentials.
  return Object.keys(createAttachmentParsers(host, { type: 'local' })).filter(isActiveDocumentParser)
}
