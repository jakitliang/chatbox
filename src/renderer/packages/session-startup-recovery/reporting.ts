import platform from '@/platform'
import type { SessionStartupDiagnostic } from './diagnostics'

export async function getDiagnosticEnvironment() {
  const [version, os] = await Promise.all([
    platform.getVersion().catch(() => 'unknown'),
    platform.getPlatform().catch(() => 'unknown'),
  ])
  const safe = (value: string) => (/^[A-Za-z0-9._+ -]{1,80}$/.test(value) ? value : 'unknown')
  return { version: safe(version), platform: `${platform.type}/${safe(os)}` }
}

/** Standalone diagnostics stay local, regardless of legacy reporting preferences. */
export async function reportStartupFailure(
  _sessionId: string,
  _diagnostic: SessionStartupDiagnostic
): Promise<string | undefined> {
  return undefined
}
