import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureLocalRuntime, createPrivateFetch, getApplicationApiOrigin, isNetworkUrlAllowed, LOCAL_SERVICE_ORIGIN, LocalNetworkBlockedError, normalizeAppApiServer } from './local-runtime'

afterEach(() => configureLocalRuntime(() => ({})))
describe('local privacy boundary', () => {
  it('normalizes a self-hosted application API origin and rejects credentials, paths and forbidden domains', () => {
    expect(normalizeAppApiServer(' http://localhost:3002/ ')).toBe('http://localhost:3002')
    for (const input of ['https://api.chatboxai.app', 'https://api.example.com/api', 'https://user:secret@api.example.com', 'https://api.example.com/?key=secret', 'ws://api.example.com']) {
      expect(() => normalizeAppApiServer(input)).toThrow()
    }
  })
  it('authorizes only the selected application origin and revokes it when switching back to local', () => {
    configureLocalRuntime(() => ({ localRuntime: { appApiServer: 'https://ui-api.example.com:8443', allowedOrigins: [] } }))
    expect(getApplicationApiOrigin()).toBe('https://ui-api.example.com:8443')
    expect(isNetworkUrlAllowed('https://ui-api.example.com:8443/api/remote_config/current_version')).toBe(true)
    expect(isNetworkUrlAllowed('https://ui-api.example.com')).toBe(false)
    expect(isNetworkUrlAllowed('https://ui-api.example.com.evil.test:8443')).toBe(false)
    configureLocalRuntime(() => ({}))
    expect(getApplicationApiOrigin()).toBe(LOCAL_SERVICE_ORIGIN)
    expect(isNetworkUrlAllowed('https://ui-api.example.com:8443')).toBe(false)
  })
  it('does not honor invalid or forbidden persisted application servers', () => {
    for (const appApiServer of ['https://api.chatboxai.app', 'https://ui-api.example.com/api', 'not-a-url']) {
      configureLocalRuntime(() => ({ localRuntime: { appApiServer, allowedOrigins: [] } }))
      expect(getApplicationApiOrigin()).toBe(LOCAL_SERVICE_ORIGIN)
    }
  })
  it('denies remote hosts by default and allows only literal loopback hosts', () => {
    expect(isNetworkUrlAllowed('https://api.openai.com')).toBe(false)
    expect(isNetworkUrlAllowed('http://127.0.0.1:11434')).toBe(true)
    expect(isNetworkUrlAllowed('http://[::1]:11434')).toBe(true)
    expect(isNetworkUrlAllowed('http://localhost.evil.test')).toBe(false)
  })
  it('never allows vendor or telemetry hosts, even in the allowlist', () => {
    configureLocalRuntime(() => ({ localRuntime: { allowedOrigins: ['https://api.chatboxai.app', 'https://plausible.midway.run', 'https://api.openai.com'] } }))
    expect(isNetworkUrlAllowed('https://api.chatboxai.app')).toBe(false)
    expect(isNetworkUrlAllowed('https://plausible.midway.run')).toBe(false)
    expect(isNetworkUrlAllowed('https://api.openai.com/v1')).toBe(true)
    expect(isNetworkUrlAllowed('https://api.openai.com:8443/v1')).toBe(false)
    expect(isNetworkUrlAllowed('https://api.openai.com.evil.test')).toBe(false)
  })
  it('serves local fixtures and rejects cloud operations without invoking any transport', async () => {
    const transport = vi.fn<typeof fetch>()
    const fetch = createPrivateFetch(transport)
    const config = await fetch(`${LOCAL_SERVICE_ORIGIN}/api/remote_config/product_ids`)
    expect(await config.json()).toMatchObject({ data: { product_ids: [], setting_chatboxai_first: false } })
    const upload = await fetch(`${LOCAL_SERVICE_ORIGIN}/api/files/generate-upload-url`, { method: 'POST', body: 'private data' })
    expect(upload.status).toBe(403)
    await expect(fetch('https://api.chatboxai.app/private')).rejects.toBeInstanceOf(LocalNetworkBlockedError)
    expect(transport).not.toHaveBeenCalled()
  })
  it('does not follow an allowed provider redirect to a forbidden host', async () => {
    configureLocalRuntime(() => ({ localRuntime: { allowedOrigins: ['https://api.openai.com'] } }))
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://api.chatboxai.app/leak' } }))
    await expect(createPrivateFetch(transport)('https://api.openai.com/start')).rejects.toBeInstanceOf(LocalNetworkBlockedError)
    expect(transport).toHaveBeenCalledTimes(1)
  })
})