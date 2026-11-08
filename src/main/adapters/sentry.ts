import type { SentryAdapter, SentryScope } from '../../shared/utils/sentry_adapter'

/** Legacy compatibility only. No SDK, identifiers, queues, or uploads. */
export class MainSentryAdapter implements SentryAdapter {
  captureException(_error: unknown): void {}

  withScope(callback: (scope: SentryScope) => void): void {
    callback({ setTag() {}, setExtra() {} })
  }
}

export const sentry = new MainSentryAdapter()

export async function flushSentry(_timeout: number): Promise<boolean> {
  return true
}
