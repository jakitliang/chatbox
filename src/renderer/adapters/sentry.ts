import type { SentryAdapter, SentryScope } from '../../shared/utils/sentry_adapter'

/** Legacy compatibility only. No SDK, identifiers, queues, or uploads. */
export class RendererSentryAdapter implements SentryAdapter {
  captureException(_error: unknown): void {}
  withScope(callback: (scope: SentryScope) => void): void {
    callback({ setTag() {}, setExtra() {} })
  }
}
