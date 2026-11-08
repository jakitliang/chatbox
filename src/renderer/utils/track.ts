import type { Plausible } from '@/analytics/plausible'

declare global {
  interface Window {
    plausible?: Plausible
  }
}

/** Permanently disabled; never read settings, URLs, globals, or event properties. */
export function trackEvent(_event: string, _props: Record<string, unknown> = {}): void {}
