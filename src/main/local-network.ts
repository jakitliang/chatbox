import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import net from 'node:net'
import { app, session, shell, type Session } from 'electron'
import { assertNetworkUrlAllowed, installPrivateFetch, isNetworkUrlAllowed } from '../shared/privacy/local-runtime'

installPrivateFetch()

function guardHttp(module: typeof http | typeof https, protocol: string): void {
  const originalRequest = module.request
  module.request = new Proxy(originalRequest, {
    apply(target, thisArg, args) {
      const first = args[0] as string | URL | http.RequestOptions
      const options = (typeof first === 'object' && !(first instanceof URL) ? first : args[1]) as http.RequestOptions | undefined
      let url = typeof first === 'string' || first instanceof URL ? new URL(first) :
        new URL(`${options?.protocol ?? protocol}//${options?.hostname ?? options?.host ?? 'localhost'}`)
      // Node merges the second argument over a URL: validate the effective destination, not just the URL.
      if (options?.protocol) url.protocol = options.protocol
      if (options?.hostname || options?.host) {
        const host = options.hostname ?? options.host!
        const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
        url = new URL(`${url.protocol}//${formattedHost}${url.port ? `:${url.port}` : ''}`)
      }
      if (options?.port) url.port = String(options.port)
      assertNetworkUrlAllowed(url)
      // Proxies can put an absolute destination in the request path.
      if (options?.path && /^https?:\/\//i.test(options.path)) assertNetworkUrlAllowed(options.path)
      return Reflect.apply(target, thisArg, args)
    },
  })
  module.get = new Proxy(module.get, {
    apply(_target, thisArg, args) {
      const request = Reflect.apply(module.request, thisArg, args) as http.ClientRequest
      request.end()
      return request
    },
  })
}
guardHttp(http, 'http:')
guardHttp(https, 'https:')

// Cover ws, raw TCP/TLS, and Node clients which do not use fetch/http.
const originalConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = new Proxy(originalConnect, {
  apply(target, thisArg, args) {
    // net.connect() passes an already-normalized [options, callback] array to Socket.connect().
    const normalized = Array.isArray(args[0]) ? args[0] : args
    const first = normalized[0]
    const options = first && typeof first === 'object' ? first as net.NetConnectOpts : undefined
    const unixSocket = options && 'path' in options && typeof options.path === 'string' && options.path.length > 0 && !('port' in options)
    if (!unixSocket && typeof first !== 'string') {
      const tcp = options as net.TcpNetConnectOpts | undefined
      const host = tcp?.host ?? (typeof normalized[1] === 'string' ? normalized[1] : 'localhost')
      const port = tcp?.port ?? first
      const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
      const httpUrl = `http://${formattedHost}:${port}`
      const httpsUrl = `https://${formattedHost}:${port}`
      if (!isNetworkUrlAllowed(httpUrl) && !isNetworkUrlAllowed(httpsUrl)) assertNetworkUrlAllowed(httpsUrl)
    }
    return Reflect.apply(target, thisArg, args)
  },
})
syncBuiltinESMExports()

/** Covers images/scripts/iframes, Chromium fetch, redirects and secondary browser partitions. */
function guardSession(ses: Session): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isNetworkUrlAllowed(details.url) })
  })
}
app.on('session-created', guardSession)
void app.whenReady().then(() => guardSession(session.defaultSession))

// Do not hand blocked URLs to an uncontrolled external browser.
const originalOpenExternal = shell.openExternal.bind(shell)
shell.openExternal = (url, options) => {
  assertNetworkUrlAllowed(url)
  return originalOpenExternal(url, options)
}
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-component-update')