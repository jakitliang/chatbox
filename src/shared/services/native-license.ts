import type { AbortSignalLike } from '../types/adapters'
import type { ChatboxAILicenseDetail } from '../types/settings'

type NativeFetchInit = NonNullable<Parameters<typeof fetch>[1]>
type NativeFetch = (input: string, init?: NativeFetchInit) => Promise<Response>

/** Compatibility API only; paid licenses are unavailable in the self-hosted edition. */

export interface NativeLicenseActivationResult {
  valid: boolean
  instanceId: string
  error?: string
}

export interface NativeLicenseRequestOptions {
  apiOrigin?: string
  fetchFn?: NativeFetch
  signal?: AbortSignalLike
  headers?: Record<string, string>
}

function unavailable(): never {
  throw new Error('Chatbox AI license services are unavailable in the self-hosted edition')
}

export async function activateNativeLicense(
  _licenseKey: string,
  _instanceName: string,
  _options: NativeLicenseRequestOptions = {}
): Promise<NativeLicenseActivationResult> {
  unavailable()
}

export async function validateNativeLicense(
  _licenseKey: string,
  _instanceId: string,
  _options: NativeLicenseRequestOptions = {}
): Promise<boolean> {
  // Do not return false: legacy callers may erase saved licenses on an invalid verdict.
  unavailable()
}

export async function deactivateNativeLicense(
  _licenseKey: string,
  _instanceId: string,
  _options: NativeLicenseRequestOptions = {}
): Promise<void> {
  unavailable()
}

export interface NativeLicenseDetailResult {
  detail: ChatboxAILicenseDetail | null
  error?: { code?: string; message?: string }
}

/** Retains the legacy detail result type without activating or reading credentials. */
export async function fetchNativeLicenseDetail(
  _licenseKey: string,
  _options: NativeLicenseRequestOptions = {}
): Promise<NativeLicenseDetailResult> {
  unavailable()
}

/** Read-only account details; this result must not activate credentials. */
export async function fetchNativeLicenseInspection(
  _licenseKey: string,
  _options: NativeLicenseRequestOptions = {}
): Promise<NativeLicenseDetailResult> {
  unavailable()
}
