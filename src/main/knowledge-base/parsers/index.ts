import {
  DocumentParseError,
  parseDocument,
  type ParserId,
  type DocumentParser as SharedDocumentParser,
  selectDocumentParser,
} from '../../../shared/document-parsing'
import { isLegacyOfficeFilePath } from '../../../shared/file-extensions'
import type { DocumentParserConfig } from '../../../shared/types/settings'
import { LocalParser } from './local-parser'
import { MineruParser } from './mineru-parser'
import type { DocumentParser, ParserFileMeta, ParserResult } from './types'

export { MineruParser, testMineruConnection } from './mineru-parser'
export * from './types'

type KnowledgeBaseInput = { name: string; path: string; meta: ParserFileMeta }

function adaptParser(id: ParserId, parser: DocumentParser): SharedDocumentParser<KnowledgeBaseInput> {
  return {
    id,
    supports: ({ path, meta }) => parser.supports(path, meta),
    parse: async ({ path, meta }, signal) => ({ text: await parser.parse(path, meta, signal) }),
  }
}

/**
 * Get effective parser configuration
 * Priority: KB config > Global config > Default (local)
 */
export function getEffectiveParserConfig(
  kbConfig?: DocumentParserConfig | null,
  globalConfig?: DocumentParserConfig | null
): DocumentParserConfig {
  if (kbConfig) {
    return kbConfig
  }
  if (globalConfig) {
    return globalConfig
  }
  return { type: 'local' }
}

/**
 * Parse a file using the appropriate parser
 * Text files always use local parsing for efficiency
 *
 * @param filePath - Path to the file
 * @param meta - File metadata
 * @param config - Parser configuration
 * @param kbId - Knowledge base ID (for vision model access)
 * @returns Parsed content and parser type used
 */
export async function parseFileWithRouter(
  filePath: string,
  meta: ParserFileMeta,
  config: DocumentParserConfig,
  kbId?: number
): Promise<ParserResult> {
  const input = { name: filePath, path: filePath, meta }
  try {
    const parser = selectDocumentParser(
      {
        local: () => adaptParser('local', new LocalParser(kbId)),
        mineru: () => {
          if (!config.mineru?.apiToken) throw new Error('MinerU API token is required')
          return adaptParser('mineru', new MineruParser(config.mineru.apiToken))
        },
      },
      config.type,
      input,
      'text-local'
    )
    const result = await parseDocument(parser, input)
    return { content: result.text, parserUsed: result.parserId }
  } catch (error) {
    if (error instanceof DocumentParseError) {
      if (error.code === 'empty') throw new Error('No content extracted from file', { cause: error })
      if (error.code === 'unsupported') {
        const message = isLegacyOfficeFilePath(filePath)
          ? 'Legacy Office formats (.doc/.xls/.ppt) are not supported by local parser. Please convert to .docx/.xlsx/.pptx.'
          : `Unsupported file type: ${meta.mimeType}`
        throw new Error(message, { cause: error })
      }
    }
    throw error
  }
}
