import { type DocumentParserType, resolveDocumentParserType } from '@chatbox/core/domain/settings'
import { isTextFilePath } from './file-extensions'

export type ParserId = Exclude<DocumentParserType, 'none' | 'chatbox-ai'>

export interface DocumentInput {
  name: string
}

export interface ParsedDocument {
  text: string
  truncated?: boolean
}

export interface DocumentParser<Input extends DocumentInput> {
  id: ParserId
  supports(input: Input): boolean
  parse(input: Input, signal?: AbortSignal): Promise<ParsedDocument>
}

export type ParserRegistry<Input extends DocumentInput> = Partial<Record<ParserId, () => DocumentParser<Input>>>

export class DocumentParseError extends Error {
  constructor(readonly code: 'not-configured' | 'unavailable' | 'unsupported' | 'empty') {
    super(code)
    this.name = 'DocumentParseError'
  }
}

export function selectDocumentParser<Input extends DocumentInput>(
  registry: ParserRegistry<Input>,
  configured: DocumentParserType,
  input: Input,
  policy?: 'text-local'
): DocumentParser<Input> {
  const id = policy === 'text-local' && isTextFilePath(input.name) ? 'local' : resolveDocumentParserType(configured)
  if (id === 'none') throw new DocumentParseError('not-configured')
  const create = registry[id]
  if (!create) throw new DocumentParseError('unavailable')
  const parser = create()
  if (!parser.supports(input)) throw new DocumentParseError('unsupported')
  return parser
}

export async function parseDocument<Input extends DocumentInput>(
  parser: DocumentParser<Input>,
  input: Input,
  signal?: AbortSignal
): Promise<ParsedDocument & { parserId: ParserId }> {
  signal?.throwIfAborted()
  const result = await parser.parse(input, signal)
  signal?.throwIfAborted()
  if (!result.text.trim()) throw new DocumentParseError('empty')
  return { ...result, parserId: parser.id }
}
