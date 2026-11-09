import type { ModelInterface } from '@shared/models/types'
import type { RequestAdapter } from '@shared/types/adapters'
import type { ImageGenerationModel, ImageModelCapabilities } from '@shared/types'
import { createModelDependencies } from '@/adapters'

/** Internal image-job identity only; deliberately not registered as a general provider. */
export const LOCAL_IMAGE_BACKEND_ID = 'local-sdapi'
const PROBE_TIMEOUT_MS = 5000
const CANCELLED = 'Local image request cancelled. The server may continue generating; no global interrupt was sent.'

export function validateLocalImageSteps(steps: number): number {
  if (!Number.isInteger(steps) || steps < 1 || steps > 40)
    throw new Error('Local image steps must be an integer from 1 to 40.')
  return steps
}

export interface LocalImageModel {
  id: string
  name: string
  description?: string
  recipe?: string
  models?: Record<string, string>
  loaded: boolean
  capabilities: ImageModelCapabilities
  referenceMode: 'none' | 'img2img' | 'reference'
  defaults?: Record<string, unknown>
}

export interface LocalImageDiscovery {
  baseUrl: string
  models: LocalImageModel[]
  currentModelId?: string
  samplerName: string
  native: boolean
  revision?: number
}

const MODEL_PREFIX = 'local-sdapi:v2:'
const LEGACY_PREFIX = 'local-sdapi:v1:'
function configurationId(recipe: string, models: Record<string, string>): string {
  return MODEL_PREFIX + JSON.stringify({ recipe, models: Object.fromEntries(Object.entries(models).sort()) })
}

/** Old records used the URL (or a v1 URL/checkpoint identity) as modelId. */
export function resolveLocalImageJob(model: ImageGenerationModel): { url: string; steps: number; modelId?: string } {
  if (model.localBackend)
    return {
      url: normalizeLocalImageBackendUrl(model.localBackend.url),
      steps: validateLocalImageSteps(model.localBackend.steps),
      modelId: model.modelId,
    }
  if (model.modelId.startsWith(LEGACY_PREFIX)) {
    const old = JSON.parse(model.modelId.slice(LEGACY_PREFIX.length))
    return { url: normalizeLocalImageBackendUrl(old.baseUrl), steps: 20, modelId: old.checkpoint }
  }
  return { url: normalizeLocalImageBackendUrl(model.modelId), steps: 20 }
}

export function normalizeLocalImageBackendUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Local image backend URL must be an absolute HTTP or HTTPS URL.')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    // URL.search/hash omit empty delimiters, which are forbidden as well.
    url.href.includes('?') ||
    url.href.includes('#')
  ) {
    throw new Error('Local image backend URL must use HTTP or HTTPS without credentials, query, or fragment.')
  }
  return url.href.replace(/\/+$/, '')
}

function abortError(): Error {
  const error = new Error(CANCELLED)
  error.name = 'AbortError'
  return error
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

async function requestJson(
  request: RequestAdapter,
  baseUrl: string,
  path: string,
  signal?: AbortSignal,
  body?: Record<string, unknown>,
  timeoutMs?: number
): Promise<unknown> {
  assertActive(signal)
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  let timedOut = false
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
    : undefined
  try {
    const response = await request.fetchWithOptions(
      `${baseUrl}${path.startsWith('/') ? path : `/sdapi/v1/${path}`}`,
      {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
      },
      { retry: 0, parseChatboxRemoteError: false }
    )
    assertActive(signal)
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      throw new Error('Redirects are not allowed for the local image backend.')
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000)
      throw Object.assign(new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`), { statusCode: response.status })
    }
    try {
      const data: unknown = await response.json()
      assertActive(signal)
      return data
    } catch (error) {
      if (signal?.aborted || controller.signal.aborted) throw error
      throw new Error('Expected a JSON response from the SD API.')
    }
  } catch (error) {
    if (signal?.aborted) throw abortError()
    if (timedOut) throw new Error(`Local image backend ${path} timed out after ${timeoutMs} ms.`)
    if (error instanceof Error && error.name === 'AbortError') throw abortError()
    throw Object.assign(
      new Error(`Local image backend ${path} failed: ${error instanceof Error ? error.message : String(error)}`),
      {
        statusCode: record(error)?.statusCode ?? record(error)?.status,
      }
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

async function inspectBackend(request: RequestAdapter, baseUrl: string, signal?: AbortSignal) {
  const models = await requestJson(request, baseUrl, 'sd-models', signal, undefined, PROBE_TIMEOUT_MS)
  if (
    !Array.isArray(models) ||
    (models.length > 0 &&
      !models.some((model) => {
        const entry = record(model)
        return [entry?.model_name, entry?.title].some((name) => typeof name === 'string' && name.trim())
      }))
  ) {
    throw new Error('Local image backend sd-models must return an array with at least one available model.')
  }
  const samplers = await requestJson(request, baseUrl, 'samplers', signal, undefined, PROBE_TIMEOUT_MS)
  if (!Array.isArray(samplers)) throw new Error('Local image backend samplers must return an array.')
  const names = samplers
    .map((sampler) => record(sampler)?.name)
    .filter((name): name is string => typeof name === 'string' && !!name.trim())
  const samplerName = names.find((name) => name.toLowerCase() === 'euler') ?? names[0]
  if (!samplerName) throw new Error('Local image backend has no available sampler.')
  return { baseUrl, samplerName, entries: models }
}

export async function validateLocalImageBackend(url: string, signal?: AbortSignal): Promise<LocalImageDiscovery> {
  const baseUrl = normalizeLocalImageBackendUrl(url)
  assertActive(signal)
  const { request } = await createModelDependencies()
  return discover(request, baseUrl, signal)
}

export const getLocalImageModels = validateLocalImageBackend

function stringMap(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value) ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1]
    )
  )
}

function localModel(recipe: Record<string, unknown>, models: Record<string, string>, loaded: boolean): LocalImageModel {
  const features = record(recipe.effective_features) ?? {}
  const referenceMode = features.ref_images === true ? 'reference' : features.img2img === true ? 'img2img' : 'none'
  return {
    id: configurationId(String(recipe.id), models),
    name: String(recipe.name ?? recipe.id),
    description: Object.values(models).map((file) => file.split('/').pop()).join('\n'),
    recipe: String(recipe.id),
    models,
    loaded,
    referenceMode,
    capabilities: {
      aspectRatio: {},
      inputReferences: referenceMode === 'none' ? null : referenceMode === 'img2img' ? { max: 1 } : {},
    },
    defaults: record(recipe.defaults),
  }
}

// Categories alone do not prove architecture compatibility (SD1 and SDXL both use checkpoints).
// Unknown/ambiguous files are deliberately omitted unless the server has already loaded them.
function compatible(file: Record<string, unknown>, recipeId: string, slotId: string): boolean {
  const name = String(file.name ?? file.id)
    .toLowerCase()
    .replace(/[_ .]/g, '-')
  if (slotId === 'model' || slotId === 'diffusion_model') {
    if (recipeId === 'sd1-checkpoint') return /(?:^|[-/])(?:sd-?1[.-]?[45]?|v1-?[45])(?:[-/]|$)/.test(name)
    if (recipeId === 'sdxl-checkpoint') return /sdxl|sd-xl/.test(name)
    // Non-checkpoint architectures require an explicit recipe/family match in the filename.
    return name.includes(recipeId) || name.includes(recipeId.replace(/-/g, ''))
  }
  if (slotId === 'vae' || slotId === 'tae')
    return name.includes(recipeId.split('-')[0]) && (name.includes('vae') || name.includes('tae'))
  return name.includes(slotId.replace(/_/g, '-')) || (slotId === 't5xxl' && name.includes('t5'))
}

async function discover(request: RequestAdapter, baseUrl: string, signal?: AbortSignal): Promise<LocalImageDiscovery> {
  const { samplerName, entries } = await inspectBackend(request, baseUrl, signal)
  let status: Record<string, unknown>
  try {
    const value = await requestJson(request, baseUrl, '/sdcpp/v1/models/status', signal, undefined, PROBE_TIMEOUT_MS)
    if (!record(value) || typeof record(value)?.state !== 'string') throw new Error('Invalid native model status.')
    status = record(value)!
  } catch (error) {
    if (![404, 405].includes(Number(record(error)?.statusCode))) throw error
    // Generic SDAPI cannot safely load a selection. Expose only its current checkpoint.
    let current = Array.isArray(entries) && entries.length === 1 ? record(entries[0]) : undefined
    if (!current) {
      const options = record(await requestJson(request, baseUrl, 'options', signal, undefined, PROBE_TIMEOUT_MS))
      current = Array.isArray(entries)
        ? entries.map(record).find((m) => m?.title === options?.sd_model_checkpoint)
        : undefined
    }
    if (!current) throw new Error('Cannot identify the currently loaded SD API model.')
    const id = String(current.title ?? current.model_name)
    return {
      baseUrl,
      samplerName,
      native: false,
      currentModelId: id,
      models: [
        {
          id,
          name: id,
          loaded: true,
          referenceMode: 'img2img',
          capabilities: { aspectRatio: {}, inputReferences: { max: 1 } },
        },
      ],
    }
  }
  const recipesValue = await requestJson(request, baseUrl, '/sdcpp/v1/recipes', signal, undefined, PROBE_TIMEOUT_MS)
  const filesValue = await requestJson(request, baseUrl, '/sdcpp/v1/model-files', signal, undefined, PROBE_TIMEOUT_MS)
  const recipes = Array.isArray(recipesValue) ? recipesValue : record(recipesValue)?.recipes
  const files = record(filesValue)?.files
  if (!Array.isArray(recipes) || !Array.isArray(files)) throw new Error('Invalid native recipes or model-files response.')
  const models: LocalImageModel[] = []
  const loadedModels = stringMap(status.models)
  for (const raw of recipes) {
    const recipe = record(raw)
    if (!recipe || typeof recipe.id !== 'string' || !Array.isArray(recipe.slots)) continue
    const slots = recipe.slots.map(record).filter((s): s is Record<string, unknown> => !!s && typeof s.id === 'string')
    const selected: Record<string, string> = {}
    const requiredAny = Array.isArray(recipe.required_any) ? (recipe.required_any.filter(Array.isArray) as string[][]) : []
    for (const slot of slots) {
      if (!slot.required && !requiredAny.some((group) => group.includes(String(slot.id)))) continue
      const categories = Array.isArray(slot.categories) ? slot.categories : [slot.category]
      const candidates = files
        .map(record)
        .filter(
          (file): file is Record<string, unknown> =>
            !!file &&
            typeof file.id === 'string' &&
            categories.includes(file.category) &&
            compatible(file, String(recipe.id), String(slot.id))
        )
      if (candidates.length === 1) selected[String(slot.id)] = String(candidates[0].id)
    }
    const primary = slots.find((s) => s.id === 'model' || s.id === 'diffusion_model')
    const primaryFiles = primary
      ? files
          .map(record)
          .filter(
            (file): file is Record<string, unknown> =>
              !!file &&
              typeof file.id === 'string' &&
              (Array.isArray(primary.categories) ? primary.categories : [primary.category]).includes(file.category) &&
              compatible(file, String(recipe.id), String(primary.id))
          )
      : []
    for (const file of primaryFiles) {
      const selection = { ...selected, [String(primary!.id)]: String(file.id) }
      if (
        slots.some((s) => s.required && !selection[String(s.id)]) ||
        requiredAny.some((group) => !group.some((id) => selection[id]))
      )
        continue
      models.push(localModel(recipe, selection, false))
    }
    if (status.state === 'ready' && status.recipe === recipe.id && Object.keys(loadedModels).length) {
      models.push(localModel(recipe, loadedModels, true))
    }
  }
  // Keep an unknown currently loaded configuration, with conservative reference support.
  if (
    status.state === 'ready' &&
    typeof status.recipe === 'string' &&
    Object.keys(loadedModels).length &&
    !models.some((m) => m.loaded)
  ) {
    models.push(localModel({ id: status.recipe, name: status.recipe }, loadedModels, true))
  }
  const unique = [...new Map(models.map((m) => [m.id, m])).values()]
  return {
    baseUrl,
    samplerName,
    native: true,
    models: unique,
    currentModelId: unique.find((m) => m.loaded)?.id,
    revision: typeof status.revision === 'number' ? status.revision : undefined,
  }
}

export function selectLocalImageModel(discovery: LocalImageDiscovery, modelId?: string): LocalImageModel {
  const selected = discovery.models.find(
    (m) =>
      m.id === (modelId ?? discovery.currentModelId) || (modelId && Object.values(m.models ?? {}).includes(modelId))
  )
  if (!selected) throw new Error('Selected local image model is not installed or its required components are unavailable.')
  return selected
}

export function validateLocalImageReferences(model: LocalImageModel, count: number): void {
  if (count && model.referenceMode === 'none')
    throw new Error('Selected local image model does not support reference images.')
  if (model.referenceMode === 'img2img' && count > 1)
    throw new Error('Selected local image model supports only one reference image.')
}

function dimensions(aspectRatio?: string, edge = 512): { width: number; height: number } {
  if (!aspectRatio || aspectRatio === 'auto') return { width: edge, height: edge }
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspectRatio)
  const ratio = match ? Number(match[1]) / Number(match[2]) : Number.NaN
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('Local image aspect ratio must be positive width:height.')
  const round = (value: number) => Math.max(64, Math.min(edge, Math.round(value / 64) * 64))
  return ratio >= 1 ? { width: edge, height: round(edge / ratio) } : { width: round(edge * ratio), height: edge }
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const activeBackends = new Set<string>()

export function createLocalImageModel(baseUrl: string, modelId?: string, steps = 20): Pick<ModelInterface, 'paint'> {
  const normalizedUrl = normalizeLocalImageBackendUrl(baseUrl)
  validateLocalImageSteps(steps)
  return {
    async paint(params, signal, callback) {
      assertActive(signal)
      if (!Number.isInteger(params.num) || params.num < 1) throw new Error('Image count must be a positive integer.')
      dimensions(params.aspectRatio)
      const references = params.images?.map((image) => image.imageUrl) ?? []
      // Never let SD API fetch an arbitrary URL on the user's behalf (including LAN URLs).
      for (const reference of references) {
        const match = /^data:image\/(?:png|jpeg|webp|gif);base64,(.+)$/.exec(reference)
        if (!match || !BASE64.test(match[1]))
          throw new Error('Reference image must be a nonempty base64 image data URL.')
      }
      if (activeBackends.has(normalizedUrl)) throw new Error('This local image backend already has an active request.')
      activeBackends.add(normalizedUrl)
      try {
        const { request } = await createModelDependencies()
        let discovery = await discover(request, normalizedUrl, signal)
        const selected = selectLocalImageModel(discovery, modelId)
        validateLocalImageReferences(selected, references.length)
        if (discovery.native && selected.id !== discovery.currentModelId) {
          await requestJson(request, normalizedUrl, '/sdcpp/v1/models/load', signal, {
            recipe: selected.recipe,
            models: selected.models,
          })
          discovery = await discover(request, normalizedUrl, signal)
          if (discovery.currentModelId !== selected.id)
            throw new Error('Local image backend did not load the selected model.')
        }
        const configuredEdge = Number(selected.defaults?.width)
        const size = dimensions(params.aspectRatio, configuredEdge >= 512 && configuredEdge <= 2048 ? configuredEdge : 512)
        const reference = references[0]
        const path = reference && selected.referenceMode === 'img2img' ? 'img2img' : 'txt2img'
        if (discovery.native) {
          const status = record(
            await requestJson(request, normalizedUrl, '/sdcpp/v1/models/status', signal, undefined, PROBE_TIMEOUT_MS)
          )
          if (
            status?.state !== 'ready' ||
            configurationId(String(status.recipe), stringMap(status.models)) !== selected.id ||
            (discovery.revision !== undefined && status.revision !== discovery.revision)
          ) {
            throw new Error('Local image model changed before generation. Retry the original job.')
          }
        }
        const response = await requestJson(request, normalizedUrl, path, signal, {
          prompt: params.prompt,
          ...size,
          steps,
          cfg_scale: typeof selected.defaults?.cfg_scale === 'number' ? selected.defaults.cfg_scale : 7,
          sampler_name: discovery.samplerName,
          batch_size: 1,
          n_iter: params.num,
          ...(reference
            ? selected.referenceMode === 'reference'
              ? { extra_images: references }
              : { init_images: [reference], denoising_strength: 0.45 }
            : {}),
        })
        if (discovery.native) {
          const status = record(
            await requestJson(request, normalizedUrl, '/sdcpp/v1/models/status', signal, undefined, PROBE_TIMEOUT_MS)
          )
          if (
            status?.state !== 'ready' ||
            configurationId(String(status.recipe), stringMap(status.models)) !== selected.id ||
            (discovery.revision !== undefined && status.revision !== discovery.revision)
          ) {
            throw new Error('Local image model changed during generation; results were discarded. Retry the original job.')
          }
        }
        const images = record(response)?.images
        if (
          !Array.isArray(images) ||
          !images.length ||
          !images.every((image) => typeof image === 'string' && image.length > 0 && BASE64.test(image))
        ) {
          throw new Error(`Local image backend ${path} must return a nonempty images array of base64 PNG data.`)
        }
        const results = images.map((image: string) => `data:image/png;base64,${image}`)
        for (const image of results) {
          assertActive(signal)
          await callback?.(image)
        }
        assertActive(signal)
        return results
      } finally {
        activeBackends.delete(normalizedUrl)
      }
    },
  }
}