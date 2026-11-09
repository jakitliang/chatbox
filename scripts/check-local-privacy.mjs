import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import Module, { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// In-memory transpilation: this check never builds the app, writes fixtures, or contacts a vendor.
const require = createRequire(import.meta.url)
const ts = require(process.env.CHATBOX_TYPESCRIPT_PATH || 'typescript')
const root = fileURLToPath(new URL('../', import.meta.url))
function load(relative, overrides = {}) {
  const file = path.join(root, relative)
  const mod = new Module(file)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(root)
  const original = mod.require.bind(mod)
  mod.require = (name) => Object.hasOwn(overrides, name) ? overrides[name] : original(name)
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  })
  mod._compile(compiled.outputText, file)
  return mod.exports
}

const policy = load('src/shared/privacy/local-runtime.ts')
assert.equal(policy.isNetworkUrlAllowed('https://api.openai.com/v1/chat'), false)
for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
  assert.equal(policy.isNetworkUrlAllowed(`http://${host}:11434/api/chat`), true)
}
for (const url of ['http://localhost.evil.test', 'https://api.chatboxai.app', 'https://plausible.midway.run', policy.LOCAL_SERVICE_ORIGIN]) {
  assert.equal(policy.isNetworkUrlAllowed(url), false)
}
let calls = 0
const privateFetch = policy.createPrivateFetch(async () => { calls++; return new Response('{}') })
const local = (path, options) => privateFetch(policy.LOCAL_SERVICE_ORIGIN + path, options)
assert.deepEqual((await (await local('/api/remote_config/product_ids')).json()).data.product_ids, [])
assert.equal((await (await local('/api/client_notifications/next')).json()).data, null)
assert.equal((await (await local('/api/license/validate')).json()).valid, false)
assert.equal(calls, 0)
await assert.rejects(privateFetch('https://api.chatboxai.app/private?token=secret'), policy.LocalNetworkBlockedError)
await assert.rejects(privateFetch('https://api.lemonsqueezy.com/v1/licenses/validate'), policy.LocalNetworkBlockedError)
assert.equal(calls, 0)
policy.configureLocalRuntime(() => ({
  localRuntime: { allowedOrigins: ['https://api.openai.com', 'https://api.chatboxai.app'], remoteConfig: { current_version: 'local-version', setting_chatboxai_first: true } },
  providers: { openai: { models: [{ modelId: 'local-model', nickname: 'Local' }] } },
}))
assert.equal(policy.isNetworkUrlAllowed('https://api.openai.com/v1/chat'), true)
assert.equal(policy.isNetworkUrlAllowed('https://api.openai.com:8443/v1/chat'), false)
assert.equal(policy.isNetworkUrlAllowed('https://api.openai.com.evil.test/v1/chat'), false)
assert.equal(policy.isNetworkUrlAllowed('https://api.chatboxai.app/api'), false)
assert.equal((await (await local('/api/remote_config/current_version')).json()).data.current_version, 'local-version')
assert.equal((await (await local('/api/remote_config/setting_chatboxai_first')).json()).data.setting_chatboxai_first, false)
const manifest = await (await local('/api/model_manifest', { method: 'POST', body: JSON.stringify({ aiProvider: 'openai' }) })).json()
assert.equal(manifest.data.models[0].modelName, 'Local')
const blockedRedirect = policy.createPrivateFetch(async () => {
  calls++
  return new Response(null, { status: 302, headers: { location: 'https://api.chatboxai.app/exfil' } })
})
await assert.rejects(blockedRedirect('https://api.openai.com/start'), policy.LocalNetworkBlockedError)
assert.equal(calls, 1)
assert.equal((await local('/api/document/parse', { method: 'POST', body: 'private document' })).status, 403)
const redirectHeaders = []
const safeRedirect = policy.createPrivateFetch(async (request) => {
  redirectHeaders.push(new Headers(request.headers))
  return redirectHeaders.length === 1
    ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:11434/next' } })
    : new Response('redirect-ok')
})
assert.equal(await (await safeRedirect('https://api.openai.com/start', { headers: { Authorization: 'secret' } })).text(), 'redirect-ok')
assert.equal(redirectHeaders[0].get('authorization'), 'secret')
assert.equal(redirectHeaders[1].has('authorization'), false)
policy.configureLocalRuntime(() => ({}))

// Application API Server is independent of model endpoints and explicitly authorizes its origin.
const apiOrigin = load('src/shared/request/chatbox-api-origin.ts', { '../privacy/local-runtime': policy })
assert.equal(apiOrigin.getChatboxAPIOrigin(), '')
apiOrigin.configureAppApiServer(() => 'https://ui-api.example.test:8443')
policy.configureLocalRuntime(() => ({ localRuntime: { appApiServer: 'https://ui-api.example.test:8443/', allowedOrigins: [] } }))
assert.equal(apiOrigin.getChatboxAPIOrigin(), 'https://ui-api.example.test:8443')
assert.equal(policy.isNetworkUrlAllowed('https://ui-api.example.test:8443/api/remote_config/current_version'), true)
assert.equal(policy.isNetworkUrlAllowed('https://ui-api.example.test/api'), false)
assert.equal(policy.isNetworkUrlAllowed('https://ui-api.example.test.evil.test:8443/api'), false)
apiOrigin.setDynamicChatboxAPIOrigin('https://api.chatboxai.app')
assert.equal(apiOrigin.getChatboxAPIOrigin(), 'https://ui-api.example.test:8443')
let backendCalls = 0
const backendFetch = policy.createPrivateFetch(async (request) => {
  backendCalls++
  assert.equal(request.url, 'https://ui-api.example.test:8443/api/remote_config/current_version')
  return new Response(JSON.stringify({ data: { current_version: 'self-hosted' } }))
})
assert.equal((await (await backendFetch(`${apiOrigin.getChatboxAPIOrigin()}/api/remote_config/current_version`)).json()).data.current_version, 'self-hosted')
assert.equal(backendCalls, 1)
for (const appApiServer of ['https://ui-api.example.test/api', 'https://user:secret@ui-api.example.test', 'not-a-url']) {
  apiOrigin.configureAppApiServer(() => appApiServer)
  assert.throws(() => apiOrigin.getChatboxAPIOrigin())
}
policy.configureLocalRuntime(() => ({}))
apiOrigin.configureAppApiServer(() => '')
assert.equal(apiOrigin.getChatboxAPIOrigin(), '')
assert.equal(policy.isNetworkUrlAllowed('https://ui-api.example.test:8443/api'), false)

const consentTimer = globalThis.setInterval
let timerCalls = 0
globalThis.setInterval = () => { timerCalls++; throw new Error('Telemetry must not install timers') }
try {
  await load('src/renderer/setup/ga_init.ts').initGoogleAnalyticsTracking()
  await load('src/renderer/setup/jk_analytics_init.ts').initJkTracking()
  let subscriptions = 0
  await load('src/renderer/setup/plausible_init.ts').initPlausibleTracking(() => { subscriptions++ })
  assert.equal(subscriptions, 0)
  assert.equal(timerCalls, 0)
} finally {
  globalThis.setInterval = consentTimer
}
const license = load('src/renderer/packages/lemonsqueezy.ts', { './remote': {
  LocalUnavailableError: class LocalUnavailableError extends Error {},
} })
await assert.rejects(license.activateLicense('private-key', 'private-device'))
await assert.rejects(license.validateLicense('private-key', 'private-device'))

// Real Node transports; Electron's boundary is exercised with a session test double.
let beforeRequest
const ses = { webRequest: { onBeforeRequest: (fn) => { beforeRequest = fn } } }
const app = new EventEmitter()
app.whenReady = () => Promise.resolve()
app.commandLine = { appendSwitch() {} }
const shell = { openExternal: async () => { throw new Error('External browser must not be opened') } }
load('src/main/local-network.ts', {
  '../shared/privacy/local-runtime': policy,
  electron: { app, session: { defaultSession: ses }, shell },
})
await Promise.resolve()
beforeRequest({ url: 'https://api.chatboxai.app/icon.png' }, (result) => assert.equal(result.cancel, true))
await assert.rejects(async () => shell.openExternal('https://chatboxai.app'), policy.LocalNetworkBlockedError)
assert.throws(() => require('node:https').request('https://example.com/private'), policy.LocalNetworkBlockedError)
assert.throws(() => require('node:http').request('http://localhost:11434', { hostname: 'example.com' }), policy.LocalNetworkBlockedError)
assert.throws(() => require('node:http').request('http://localhost:11434', { host: 'example.com' }), policy.LocalNetworkBlockedError)
assert.throws(() => new (require('node:net').Socket)().connect({ host: 'example.com', port: 443 }), policy.LocalNetworkBlockedError)
assert.throws(() => require('node:net').connect({ host: 'example.com', port: 443, path: undefined }), policy.LocalNetworkBlockedError)
const http = require('node:http')
const server = http.createServer((_req, res) => res.end('local-ok'))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
try {
  const response = await globalThis.fetch(`http://127.0.0.1:${server.address().port}/check`)
  assert.equal(await response.text(), 'local-ok')
  policy.configureLocalRuntime(() => ({ localRuntime: { appApiServer: `http://127.0.0.1:${server.address().port}`, allowedOrigins: [] } }))
  apiOrigin.configureAppApiServer(() => `http://127.0.0.1:${server.address().port}`)
  assert.equal(await (await globalThis.fetch(`${apiOrigin.getChatboxAPIOrigin()}/api/remote_config/current_version`)).text(), 'local-ok')
} finally {
  policy.configureLocalRuntime(() => ({}))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}

for (const file of ['src/renderer/index.html', 'src/renderer/index.ejs', 'src/renderer/index.web.ejs', 'src/renderer/lib/format-chat.tsx']) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  assert.doesNotMatch(source, /(?:src|href)=["']https?:\/\/(?:www\.googletagmanager|plausible\.|cdn\.|chatboxai\.)/)
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
for (const name of ['@sentry/node', '@sentry/react', '@sentry/vite-plugin', '@sentry/webpack-plugin', 'electron-updater']) {
  assert.equal(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name], undefined)
}
console.log('PASS: local fixtures, configurable application API Server, backend switching/revocation, no vendor transport, exact allowlist, blocked redirects, Node HTTP/TCP, Electron boundary, loopback HTTP, no tracking scripts/SDK roots.')