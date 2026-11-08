import type { ProviderModelGroup, ProviderModelInfo } from '../types'
import type { AbortSignalLike } from '../types/adapters'
import type { ChatboxAIPlanType } from '../types/settings'

type NativeFetchInit = NonNullable<Parameters<typeof fetch>[1]>
type NativeFetch = (input: string, init?: NativeFetchInit) => Promise<Response>

export interface NativeAccountRequestOptions {
  apiOrigin?: string
  fetchFn?: NativeFetch
  signal?: AbortSignalLike
  headers?: Record<string, string>
}

export interface NativeAccountTokens {
  accessToken: string
  refreshToken: string
}

export interface NativeAccountProfile {
  id?: string
  email: string
  createdAt?: string
}

export interface NativeAccountLicense {
  id: number
  key: string
  status: string
  platform: string
  productName: string
  plan?: ChatboxAIPlanType
  paymentType: string
  imageUsage: number
  imageLimit: number
  unifiedTokenUsage: number
  unifiedTokenLimit: number
  nextTokenRefreshAt: string
  expiresAt: string
  quotaPacks?: unknown[]
  recurringCanceled: boolean
}

export interface NativeChatboxAIModelDetail {
  modelId: string
  modelName?: string
  description?: string
  costLevel?: string
  type?: ProviderModelInfo['type']
  capabilities?: ProviderModelInfo['capabilities']
  contextWindow?: number
  available: boolean
}

export interface NativeChatboxAIModelCatalog {
  source?: 'model-list' | 'manifest'
  models: ProviderModelInfo[]
  groups: Array<ProviderModelGroup & { featuredModelIds?: string[] }>
  modelDetails: Record<string, NativeChatboxAIModelDetail>
  licensePlan?: string
  links?: { upgrade?: string }
}

/** Compatibility-only entry points: never read credentials or request options. */
function unavailable(): never {
  throw new Error('Chatbox AI account services are unavailable in the self-hosted edition')
}

export async function sendNativeEmailLoginCode(
  _email: string,
  _language: string | undefined,
  _options: NativeAccountRequestOptions = {}
): Promise<void> {
  unavailable()
}

export async function loginNativeEmailCode(
  _email: string,
  _code: string,
  _options: NativeAccountRequestOptions = {}
): Promise<NativeAccountTokens> {
  unavailable()
}

export async function refreshNativeAccountTokens(
  _refreshToken: string,
  _options: NativeAccountRequestOptions = {}
): Promise<NativeAccountTokens> {
  unavailable()
}

export async function generateNativeWebAuthToken(
  _accessToken: string,
  _options: NativeAccountRequestOptions = {}
): Promise<string> {
  unavailable()
}

export async function fetchNativeAccountProfile(
  _accessToken: string,
  _options: NativeAccountRequestOptions = {}
): Promise<NativeAccountProfile> {
  unavailable()
}

export async function fetchNativeAccountLicenses(
  _accessToken: string,
  _options: NativeAccountRequestOptions = {}
): Promise<NativeAccountLicense[]> {
  unavailable()
}

export async function fetchNativeChatboxAIModelCatalog(
  _licenseKey: string | undefined,
  _language: string | undefined,
  _options: NativeAccountRequestOptions = {}
): Promise<NativeChatboxAIModelCatalog> {
  unavailable()
}

export async function fetchNativeChatboxAIModels(
  _licenseKey: string | undefined,
  _language: string | undefined,
  _options: NativeAccountRequestOptions = {}
): Promise<ProviderModelInfo[]> {
  unavailable()
}
