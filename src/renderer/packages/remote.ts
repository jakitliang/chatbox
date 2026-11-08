import type {
  ImageCompletionRequest,
  ImageGenerationAPIResponse,
} from '@chatbox/core/application/image-generation'
import { loadLocalCopilots } from '@/catalog/local-copilot-catalog'
import { loadLocalModelManifest, type LocalModelInfo } from '@/catalog/local-model-manifest'
import { LOCAL_RUNTIME_CONFIG, loadLocalSessionRagConfig } from '@/catalog/local-runtime-config'
import type { ClaimedAgentModeReward } from '@/packages/agent-mode-reward'
import { getChatboxAPIOrigin } from '../../shared/request/chatboxai_pool'
import type {
  ChatboxAILicenseDetail,
  ChatboxAIPlanType,
  Config,
  CopilotDetail,
  ModelProvider,
  ProviderModelInfo,
  RemoteConfig,
  SessionRagConfig,
  Settings,
} from '../../shared/types'

/** Resolve at request time: changing the selected backend must not require a reload. */
export function getAPIOrigin() {
  return getChatboxAPIOrigin()
}

export function getChatboxOrigin() {
  return 'about:blank'
}

/** Retired website/entitlement links must not target the manual sync server. */
export function buildChatboxUrl(_path: string) {
  return 'about:blank'
}

export async function listCopilotTags(lang: string): Promise<string[]> {
  return [...new Set(loadLocalCopilots(lang).flatMap((copilot) => copilot.tags ?? []))]
}

export async function listCopilotsByCursor(
  lang: string,
  filters?: { limit?: number; cursor?: string; tag?: string; search?: string }
): Promise<{ data: CopilotDetail[]; next_cursor: string | null }> {
  const search = filters?.search?.toLocaleLowerCase() ?? ''
  const copilots = loadLocalCopilots(lang).filter((copilot) =>
    (!filters?.tag || copilot.tags?.includes(filters.tag)) &&
    (!search || `${copilot.name} ${copilot.description ?? ''}`.toLocaleLowerCase().includes(search))
  )
  const parsedCursor = Number(filters?.cursor ?? 0)
  const cursor = Number.isSafeInteger(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0
  const limit = Math.max(1, Math.min(100, Math.floor(filters?.limit || 20)))
  const data = copilots.slice(cursor, cursor + limit)
  return { data, next_cursor: cursor + limit < copilots.length ? String(cursor + limit) : null }
}

export async function getRemoteConfig<K extends keyof RemoteConfig>(config: K): Promise<Pick<RemoteConfig, K>> {
  return { [config]: structuredClone(LOCAL_RUNTIME_CONFIG[config]) } as Pick<RemoteConfig, K>
}

/** Local RAG uses user-selected models, never backend model/capability metadata. */
export async function getSessionRagConfig(_params?: { licenseKey?: string }): Promise<SessionRagConfig> {
  return loadLocalSessionRagConfig()
}

/** Compatibility with callers that used to invalidate on license changes. */
export function invalidateSessionRagConfigCache(_licenseKey?: string) {}

export type RemoteModelInfo = LocalModelInfo

export async function getModelManifest(params: { aiProvider: ModelProvider; licenseKey?: string; language?: string }) {
  return loadLocalModelManifest(params.aiProvider)
}

/** Historical types remain for existing callers and stored data, not for entitlement handling. */
export interface ChatboxAIModelList {
  provider: { id: string; name: string }
  license: { plan: string }
  groups: { id: string; modelIds: string[]; featuredModelIds?: string[] }[]
  models: Record<
    string,
    RemoteModelInfo & {
      costLevel: string
      description: string
      access: { available: boolean }
      pricing?: {
        tokensPerComputePoint: number
        officialInput: number
        officialOutput: number
        tieredPricing: {
          max_input_tokens: number
          max_output_tokens: number
          price_input: number
          price_output: number
        }[]
      }
    }
  >
  imageModels: RemoteModelInfo[]
  links?: { modelPricing?: string; upgrade?: string }
}

export interface DialogConfig {
  markdown: string
  buttons: { label: string; url: string }[]
}
export interface ClientNotification {
  cover_image_url?: string
  batch_id: string
  title: string
  subtitle?: string
  body_markdown: string
  content_language: 'zh' | 'en'
}
export interface LicenseDetailError {
  code: string
  detail: string
  status: number
  title: string
}
export interface LicenseDetailResponse {
  data: ChatboxAILicenseDetail | null
  error?: LicenseDetailError
}
export interface UserLicense {
  id: number
  key: string
  status: string
  platform: string
  product_name: string
  plan?: ChatboxAIPlanType
  payment_type: string
  image_usage: number
  unified_token_usage: number
  unified_token_limit: number
  unified_token_usage_details: { type: string; token_usage: number; token_limit: number }[]
  image_limit: number
  next_token_refresh_at: string
  expires_at: string
  created_at: string
  recurring_canceled: boolean
  quota_packs: UserLicenseQuotaPack[]
}
export interface UserLicenseQuotaPack {
  id: number
  license_key: string
  product_name: string
  quantity: number
  quota_limit: number
  quota_usage: number
  status: string
  current_period_start: string | null
  current_period_end: string | null
}

/** Explicit failure rather than silently pretending an account/business operation succeeded. */
export class LocalUnavailableError extends Error {
  readonly code = 'local_unavailable'
  constructor(operation: string) {
    super(`${operation} is unavailable in the self-hosted edition.`)
    this.name = 'LocalUnavailableError'
  }
}
function unavailable(operation: string): never {
  throw new LocalUnavailableError(operation)
}

// Inert compatibility reads. No credentials, identifiers or payloads leave the process.
export async function checkNeedUpdate(_version: string, _os: string, _config: Config, _settings: Settings) {
  return false
}
export async function getNextClientNotification(_params: { locale: string; displayed_batch_ids: string[] }): Promise<ClientNotification | null> {
  return null
}
export async function getDialogConfig(_params: { uuid: string; language: string; version: string }): Promise<DialogConfig | null> {
  return null
}
export async function getLicenseDetail(_params: { licenseKey: string }): Promise<ChatboxAILicenseDetail | null> {
  return null
}
export async function getLicenseDetailRealtime(_params: { licenseKey: string }): Promise<LicenseDetailResponse> {
  return { data: null }
}
export async function getLicenseDetailForInspection(_params: { licenseKey: string }): Promise<LicenseDetailResponse> {
  return { data: null }
}
export async function listLicensesByUser(): Promise<UserLicense[]> {
  return []
}
export async function getChatboxAIModelList(_params: { licenseKey?: string; language?: string }): Promise<ChatboxAIModelList> {
  return { provider: { id: 'chatbox-ai', name: '' }, license: { plan: 'unknown' }, groups: [], models: {}, imageModels: [] }
}
export async function getProviderModelsInfo(_params: { modelIds: string[] }): Promise<Record<string, ProviderModelInfo | null>> {
  return {}
}

// Historical business operations are deliberately unsupported. Do not serialize their arguments.
export async function recordCopilotUsage(_params: { id: string; action: 'create_session' | 'create_thread' | 'create_message' | 'use_copilot' }): Promise<void> {
  unavailable('Copilot usage reporting')
}
export async function recordCopilotShare(_detail: CopilotDetail): Promise<void> {
  unavailable('Copilot sharing')
}
export async function reportContent(_params: { id: string; type: string; details: string }): Promise<void> {
  unavailable('Content reporting')
}
export async function getPremiumPrice(): Promise<{ price: number; discount: number; discountLabel: string }> {
  return unavailable('Premium pricing')
}
export async function activateLicense(_params: { licenseKey: string; instanceName: string }): Promise<{ valid: boolean; instanceId: string; error: string }> {
  return unavailable('License activation')
}
export async function deactivateLicense(_params: { licenseKey: string; instanceId: string }): Promise<void> {
  unavailable('License deactivation')
}
export async function validateLicense(_params: { licenseKey: string; instanceId: string }): Promise<{ valid: boolean }> {
  return unavailable('License validation')
}
export async function generateUploadUrl(_params: { licenseKey: string; filename: string }, _signal?: AbortSignal): Promise<{ url: string; filename: string }> {
  return unavailable('Cloud uploads')
}
export async function createUserFile<T extends boolean>(_params: { licenseKey: string; filename: string; filetype: string; returnContent: T }, _signal?: AbortSignal): Promise<{ uuid: string; content: T extends true ? string : undefined }> {
  return unavailable('Cloud file creation')
}
export async function uploadAndParseUserFile(_licenseKey: string, _file: File, _signal: AbortSignal): Promise<string> {
  return unavailable('Cloud file parsing')
}
export async function uploadAndCreateUserFile(_licenseKey: string, _file: File): Promise<string> {
  return unavailable('Cloud file uploads')
}
export async function parseUserLinkPro(_params: { licenseKey: string; url: string; abortSignal?: AbortSignal }): Promise<{ key: string; title: string; storageKey: string }> {
  return unavailable('Cloud link parsing')
}
export async function parseUserLinkFree(_params: { url: string }): Promise<{ title: string; text: string }> {
  return unavailable('Cloud webpage proxy')
}
export async function getChatboxWebSearchRequestOptions(): Promise<{ chatboxApiOrigin: string; fetchFn: typeof fetch; headers: Record<string, string> }> {
  return unavailable('Built-in cloud web search')
}
export async function requestLoginTicketId(): Promise<string> {
  return unavailable('Account login')
}
export async function sendEmailLoginCode(_params: { email: string; lang?: string }): Promise<string> {
  return unavailable('Account login')
}
export async function loginOrSignupWithEmailCode(_params: { email: string; code: string }): Promise<{ accessToken: string; refreshToken: string }> {
  return unavailable('Account login')
}
export async function getWebAuthToken(): Promise<string> {
  return unavailable('Account authentication')
}
export async function checkLoginStatus(_ticketId: string): Promise<{ status: 'pending' | 'success' | 'rejected'; accessToken: string | null; refreshToken: string | null }> {
  return unavailable('Account login')
}
export async function refreshAccessToken(_params: { refreshToken: string }): Promise<{ accessToken: string; refreshToken: string }> {
  return unavailable('Account token refresh')
}
export async function getUserProfile(): Promise<{ email: string; id: string; created_at: string }> {
  return unavailable('Account profile')
}
export async function issueVibedropKey(): Promise<{ vdKey: string; tier: string }> {
  return unavailable('Cloud publishing')
}
export async function claimFreeAgentModeReward(_licenseKey: string): Promise<ClaimedAgentModeReward> {
  return unavailable('License rewards')
}

export type { ImageCompletionRequest, ImageGenerationItem } from '@chatbox/core/application/image-generation'
export type ImageGenerationTaskResponse = ImageGenerationAPIResponse
// Historical timing constant only; importing this module never loads an image API client.
export const IMAGE_GENERATION_POLL_INTERVAL_MS = 2000
export async function submitImageGeneration(_params: ImageCompletionRequest, _licenseKey: string): Promise<ImageGenerationTaskResponse> {
  return unavailable('Cloud image generation')
}
export async function pollImageTask(_taskId: string, _licenseKey: string, _signal?: AbortSignal): Promise<ImageGenerationTaskResponse> {
  return unavailable('Cloud image generation')
}
export async function pollTaskUntilComplete(_taskId: string, _licenseKey: string, _options?: { signal?: AbortSignal; onPoll?: (response: ImageGenerationTaskResponse) => void | Promise<void> }): Promise<ImageGenerationTaskResponse> {
  return unavailable('Cloud image generation')
}
