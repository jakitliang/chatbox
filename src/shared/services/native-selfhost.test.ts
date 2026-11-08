import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchNativeAccountLicenses,
  fetchNativeAccountProfile,
  fetchNativeChatboxAIModelCatalog,
  fetchNativeChatboxAIModels,
  generateNativeWebAuthToken,
  loginNativeEmailCode,
  refreshNativeAccountTokens,
  sendNativeEmailLoginCode,
  type NativeAccountRequestOptions,
} from './native-account'
import { type NativeDocumentParserFile, parseNativeChatboxAIDocument } from './native-document-parser'
import {
  activateNativeLicense,
  deactivateNativeLicense,
  fetchNativeLicenseDetail,
  fetchNativeLicenseInspection,
  validateNativeLicense,
} from './native-license'
import { reportNativeContent, type ReportNativeContentOptions } from './native-report'

// These replace the legacy remote-success suites: even an injected fetch/origin
// must not revive removed paid services or allow credentials/content to be read.
const accountAndLicenseCalls: Array<[string, (options?: NativeAccountRequestOptions) => Promise<unknown>]> = [
  ['send login code', (options) => sendNativeEmailLoginCode('user@example.test', 'en', options)],
  ['email login', (options) => loginNativeEmailCode('user@example.test', '123456', options)],
  ['refresh tokens', (options) => refreshNativeAccountTokens('refresh-secret', options)],
  ['web auth token', (options) => generateNativeWebAuthToken('access-secret', options)],
  ['account profile', (options) => fetchNativeAccountProfile('access-secret', options)],
  ['account licenses', (options) => fetchNativeAccountLicenses('access-secret', options)],
  ['model catalog', (options) => fetchNativeChatboxAIModelCatalog('license-secret', 'en', options)],
  ['model list', (options) => fetchNativeChatboxAIModels(undefined, undefined, options)],
  ['activate license', (options) => activateNativeLicense('license-secret', 'Device', options)],
  ['validate license', (options) => validateNativeLicense('license-secret', 'instance', options)],
  ['deactivate license', (options) => deactivateNativeLicense('license-secret', 'instance', options)],
  ['license detail', (options) => fetchNativeLicenseDetail('license-secret', options)],
  ['license inspection', (options) => fetchNativeLicenseInspection('license-secret', options)],
]

function unreadable<T extends object>(value: T): T {
  return new Proxy(value, {
    get() {
      throw new Error('Disabled service read sensitive input')
    },
  })
}

describe('self-hosted native service compatibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(accountAndLicenseCalls)('%s rejects with default and injected options without requesting', async (_name, call) => {
    const fetchFn = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchFn)
    await expect(call()).rejects.toThrow('unavailable in the self-hosted edition')
    await expect(call({ apiOrigin: 'http://127.0.0.1:4567', fetchFn })).rejects.toThrow(
      'unavailable in the self-hosted edition'
    )
    await expect(call(unreadable({ fetchFn }))).rejects.toThrow('unavailable in the self-hosted edition')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('disables chatbox-ai parsing before file inspection, upload or request', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    const upload = vi.fn<(url: string) => Promise<void>>()
    vi.stubGlobal('fetch', fetchFn)
    const file: NativeDocumentParserFile = { filename: 'private.pdf', filetype: 'application/pdf', upload }
    await expect(parseNativeChatboxAIDocument('license-secret', file)).rejects.toThrow('document parsing is disabled')
    await expect(
      parseNativeChatboxAIDocument('license-secret', file, { apiOrigin: 'http://127.0.0.1:4567', fetchFn })
    ).rejects.toThrow('use a local or BYOK parser')
    await expect(
      parseNativeChatboxAIDocument('license-secret', unreadable(file), unreadable({ fetchFn }))
    ).rejects.toThrow('document parsing is disabled')
    expect(upload).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('disables reports before reading or serializing content or options', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchFn)
    const options: ReportNativeContentOptions = {
      id: 'private message', type: 'Other', details: 'private details',
    }
    await expect(reportNativeContent(options)).rejects.toThrow('content reporting is unavailable')
    await expect(
      reportNativeContent({ ...options, apiOrigin: 'http://127.0.0.1:4567', fetchFn })
    ).rejects.toThrow('content reporting is unavailable')
    await expect(reportNativeContent(unreadable(options))).rejects.toThrow('content reporting is unavailable')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})