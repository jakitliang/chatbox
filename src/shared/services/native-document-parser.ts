import type { AbortSignalLike } from '../types/adapters'

type NativeFetchInit = NonNullable<Parameters<typeof fetch>[1]>
type NativeFetch = (input: string, init?: NativeFetchInit) => Promise<Response>

export interface NativeDocumentParserRequestOptions {
  apiOrigin?: string
  fetchFn?: NativeFetch
  headers?: Record<string, string>
  signal?: AbortSignalLike
}

export interface NativeDocumentParserFile {
  filename: string
  filetype: string
  upload(url: string): Promise<void>
}

/**
 * Compatibility entry point for the disabled chatbox-ai parser only.
 * Local and BYOK parsers are separate implementations and remain unchanged.
 * Do not inspect the file, credentials or options, or obtain an upload URL.
 */
export async function parseNativeChatboxAIDocument(
  _licenseKey: string,
  _file: NativeDocumentParserFile,
  _options: NativeDocumentParserRequestOptions = {}
): Promise<string> {
  throw new Error('Chatbox AI document parsing is disabled in the self-hosted edition; use a local or BYOK parser')
}
