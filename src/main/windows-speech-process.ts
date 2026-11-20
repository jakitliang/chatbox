import { spawn } from 'node:child_process'
import { join } from 'node:path'

export function spawnWindowsSpeech(script: string, signal?: AbortSignal, extraEnv?: NodeJS.ProcessEnv) {
  const systemRoot = process.env.SystemRoot
  if (process.platform !== 'win32' || !systemRoot) throw new Error('Windows speech is unavailable')
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return spawn(
    executable,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    {
      windowsHide: true,
      signal,
      env: extraEnv ? { ...process.env, ...extraEnv } : undefined,
    }
  )
}
