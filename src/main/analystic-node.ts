import type { AnalyticsEventParams } from '../shared/analytics'

/** Permanently disabled compatibility endpoint for the legacy IPC bridge. */
export async function event(_name: string, _params: AnalyticsEventParams = {}): Promise<null> {
  return null
}
