/** Compatibility API only; content reporting is disabled in the self-hosted edition. */

export interface ReportNativeContentOptions {
  id: string
  type: string
  details: string
  apiOrigin?: string
  fetchFn?: typeof fetch
  headers?: Record<string, string>
}

export async function reportNativeContent(_options: ReportNativeContentOptions): Promise<void> {
  throw new Error('Chatbox AI content reporting is unavailable in the self-hosted edition')
}
