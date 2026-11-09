import type { ImageGenerationServiceOptions } from '@chatbox/core/application/image-generation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLocalImageModel,
  LOCAL_IMAGE_BACKEND_ID,
  normalizeLocalImageBackendUrl,
  validateLocalImageBackend,
} from './local-image-backend'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  dependencies: vi.fn(),
  getModel: vi.fn(),
  capabilities: vi.fn(),
  settings: vi.fn(),
  config: vi.fn(),
  start: vi.fn(),
  options: undefined as ImageGenerationServiceOptions | undefined,
}))

vi.mock('@/adapters', () => ({ createModelDependencies: mocks.dependencies }))
vi.mock('@shared/providers', () => ({ getModel: mocks.getModel }))
vi.mock('@/packages/image-model-catalog', () => ({ getImageModelCapabilities: mocks.capabilities }))
vi.mock('@/stores/settingsStore', () => ({ settingsStore: { getState: mocks.settings } }))
vi.mock('@/platform', () => ({
  default: { getImageGenerationStorage: vi.fn(), getConfig: mocks.config },
}))
vi.mock('@/adapters/CurrentBlobStorage', () => ({ currentBlobStorage: {} }))
vi.mock('@/analytics/plausible', () => ({ normalizePlausibleModel: vi.fn(), normalizePlausibleProvider: vi.fn() }))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ error: vi.fn() }) }))
vi.mock('@/packages/remote', () => ({ pollImageTask: vi.fn(), submitImageGeneration: vi.fn() }))
vi.mock('@/storage/StoreStorage', () => ({ StorageKeyGenerator: { picture: vi.fn() } }))
vi.mock('@/utils/track', () => ({ trackEvent: vi.fn() }))
vi.mock('@/stores/imageGenerationStore', () => ({
  imageGenerationStore: { getState: () => ({ setCurrentRecordId: vi.fn() }) },
}))
vi.mock('@/stores/queryClient', () => ({ queryClient: {} }))
vi.mock('@chatbox/react', () => ({ getImageGenerationQueryBridge: vi.fn(() => ({})) }))
vi.mock('@chatbox/core/application/image-generation', () => ({
  ImageGenerationService: class {
    constructor(options: ImageGenerationServiceOptions) {
      mocks.options = options
    }
    subscribe() {}
    subscribeRecords() {}
    start = mocks.start
  },
}))

const BASE = 'http://192.168.1.20:7860/sd'
const PNG = 'aGVsbG8='
const DATA = `data:image/png;base64,${PNG}`
const params = { prompt: 'a landscape', num: 1 }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

function backendResponse(url: string) {
  if (url.endsWith('/sdcpp/v1/models/status')) return json({}, 404)
  if (url.endsWith('/sd-models')) return json([{ model_name: 'local-checkpoint' }])
  if (url.endsWith('/samplers')) return json([{ name: 'DPM++ 2M' }, { name: 'Euler' }])
  return json({ images: [PNG] })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.dependencies.mockResolvedValue({ request: { fetchWithOptions: mocks.fetch } })
  mocks.fetch.mockImplementation(backendResponse)
})

afterEach(() => vi.useRealTimers())

describe('local SD API URL identity', () => {
  it('uses only an internal provider ID and canonicalizes endpoint URLs', () => {
    expect(LOCAL_IMAGE_BACKEND_ID).toBe('local-sdapi')
    expect(normalizeLocalImageBackendUrl(' HTTP://LOCALHOST:80/proxy/// ')).toBe('http://localhost/proxy')
    expect(normalizeLocalImageBackendUrl('https://example.org:443/')).toBe('https://example.org')
    expect(normalizeLocalImageBackendUrl(BASE)).toBe(BASE)
    expect(normalizeLocalImageBackendUrl('http://[::1]:7860/')).toBe('http://[::1]:7860')
  })

  it.each([
    '', '/relative', 'localhost:7860', 'file:///tmp/sd', 'ftp://host', 'javascript:alert(1)',
    'http://user:pass@host', 'http://user@host', 'http://host/?x=1', 'http://host/#x',
    'http://host/?', 'http://host/#',
  ])('rejects unsafe/invalid URL %j without a request', async (url) => {
    expect(() => createLocalImageModel(url)).toThrow(/URL/)
    await expect(validateLocalImageBackend(url)).rejects.toThrow(/URL/)
    expect(mocks.dependencies).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

describe('backend validation', () => {
  it('checks both discovery arrays with short-timeout GETs and prefers supported Euler', async () => {
    await expect(validateLocalImageBackend(`${BASE}/`)).resolves.toMatchObject({ baseUrl: BASE, samplerName: 'Euler', native: false })
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/sdapi/v1/sd-models`, `${BASE}/sdapi/v1/samplers`, `${BASE}/sdcpp/v1/models/status`,
    ])
    for (const [, init, options] of mocks.fetch.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit', signal: expect.any(AbortSignal) })
      expect(options).toEqual({ retry: 0, parseChatboxRemoteError: false })
    }
  })

  it.each([null, {}, [null], [{ model_name: '' }]])('rejects missing models %j', async (models) => {
    mocks.fetch.mockResolvedValueOnce(json(models))
    await expect(validateLocalImageBackend(BASE)).rejects.toThrow(/at least one available model/)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([null, {}, [], [{ name: '' }]])('rejects invalid samplers %j', async (samplers) => {
    mocks.fetch.mockResolvedValueOnce(json([{ title: 'checkpoint' }])).mockResolvedValueOnce(json(samplers))
    await expect(validateLocalImageBackend(BASE)).rejects.toThrow(/sampler/)
  })

  it('times out a discovery request', async () => {
    vi.useFakeTimers()
    mocks.fetch.mockImplementationOnce((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const result = expect(validateLocalImageBackend(BASE)).rejects.toThrow(/sd-models timed out after 5000 ms/)
    await vi.advanceTimersByTimeAsync(5000)
    await result
  })
})

describe('paint', () => {
  it('posts txt2img defaults, converts images, and awaits callbacks', async () => {
    mocks.fetch.mockImplementation((url) => url.endsWith('/txt2img') ? json({ images: [PNG, PNG] }) : backendResponse(url))
    const callback = vi.fn(async () => {})
    await expect(createLocalImageModel(BASE).paint({ ...params, num: 2, aspectRatio: '16:9' }, undefined, callback))
      .resolves.toEqual([DATA, DATA])
    const [url, init] = mocks.fetch.mock.calls[3]
    expect(url).toBe(`${BASE}/sdapi/v1/txt2img`)
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit' })
    expect(JSON.parse(init.body)).toEqual({
      prompt: params.prompt, width: 512, height: 320, steps: 20, cfg_scale: 7,
      sampler_name: 'Euler', batch_size: 1, n_iter: 2,
    })
    expect(callback.mock.calls).toEqual([[DATA], [DATA]])
  })

  it('posts img2img with one inline reference and denoising 0.45', async () => {
    await createLocalImageModel(BASE).paint({ ...params, aspectRatio: '2:3', images: [{ imageUrl: DATA }] })
    const [url, init] = mocks.fetch.mock.calls[3]
    expect(url).toBe(`${BASE}/sdapi/v1/img2img`)
    expect(JSON.parse(init.body)).toMatchObject({
      init_images: [DATA], denoising_strength: 0.45, width: 320, height: 512,
    })
  })

  it('falls back to a sampler actually advertised by the backend', async () => {
    mocks.fetch.mockImplementation((url) => url.endsWith('/samplers') ? json([{ name: 'DPM++ 2M' }]) : backendResponse(url))
    await createLocalImageModel(BASE).paint(params)
    expect(JSON.parse(mocks.fetch.mock.calls[3][1].body).sampler_name).toBe('DPM++ 2M')
  })

  it.each([
    [undefined, 512, 512], ['auto', 512, 512], ['1:1', 512, 512], ['100:1', 512, 64], ['1:100', 64, 512],
  ])('uses 512 long-edge / 64 multiples for %s', async (aspectRatio, width, height) => {
    await createLocalImageModel(BASE).paint({ ...params, aspectRatio })
    expect(JSON.parse(mocks.fetch.mock.calls[3][1].body)).toMatchObject({ width, height })
  })

  it.each(['0:1', '1:0', '-1:2', 'bad', '1e999:1'])('rejects invalid ratio %s', async (aspectRatio) => {
    await expect(createLocalImageModel(BASE).paint({ ...params, aspectRatio })).rejects.toThrow(/aspect ratio/)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects multiple references before generation', async () => {
    await expect(createLocalImageModel(BASE).paint({ ...params, images: [{ imageUrl: DATA }, { imageUrl: DATA }] }))
      .rejects.toThrow(/only one reference/)
    expect(mocks.fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid image count %s', async (num) => {
    await expect(createLocalImageModel(BASE).paint({ ...params, num })).rejects.toThrow(/positive integer/)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each(['http://host/image.png', 'https://host/image.png', 'file:///image.png', 'data:image/png;base64,', 'data:image/png;base64,!!!!'])
    ('does not fetch or forward untrusted reference %s', async (imageUrl) => {
      await expect(createLocalImageModel(BASE).paint({ ...params, images: [{ imageUrl }] })).rejects.toThrow(/data URL/)
      expect(mocks.fetch).not.toHaveBeenCalled()
    })

  it.each([{}, { images: [] }, { images: [''] }, { images: [null] }, { images: ['https://host/image'] }, { images: ['!!!!'] }])
    ('rejects malformed generation response %j', async (response) => {
      mocks.fetch.mockImplementation((url) => url.endsWith('/txt2img') ? json(response) : backendResponse(url))
      await expect(createLocalImageModel(BASE).paint(params)).rejects.toThrow(/nonempty images array/)
    })

  it('preserves API endpoint/status/detail errors', async () => {
    mocks.fetch.mockImplementation((url) => url.endsWith('/txt2img') ? json({ detail: 'checkpoint not loaded' }, 503) : backendResponse(url))
    await expect(createLocalImageModel(BASE).paint(params)).rejects.toThrow(/txt2img failed: HTTP 503.*checkpoint not loaded/)
  })

  it('reports img2img-specific API errors', async () => {
    mocks.fetch.mockImplementation((url) => url.endsWith('/img2img') ? json({ detail: 'invalid init image' }, 422) : backendResponse(url))
    await expect(createLocalImageModel(BASE).paint({ ...params, images: [{ imageUrl: DATA }] }))
      .rejects.toThrow(/img2img failed: HTTP 422.*invalid init image/)
  })

  it('preserves errors thrown by the existing request adapter', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('Status Code 404, API disabled; use --api'))
    await expect(validateLocalImageBackend(BASE)).rejects.toThrow(/sd-models failed:.*404.*--api/)
  })

  it('rejects invalid JSON and redirects', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('<html>not an API</html>'))
    await expect(validateLocalImageBackend(BASE)).rejects.toThrow(/JSON/)
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'http://untrusted/' } }))
    await expect(validateLocalImageBackend(BASE)).rejects.toThrow(/Redirects are not allowed/)
  })

  it('does not make requests for an already cancelled operation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(createLocalImageModel(BASE).paint(params, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(validateLocalImageBackend(BASE, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.dependencies).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('forwards cancellation into the POST without ever invoking global interrupt', async () => {
    const controller = new AbortController()
    let requestSignal: AbortSignal | undefined
    mocks.fetch.mockImplementation((url, init: RequestInit) => {
      if (!url.endsWith('/txt2img')) return backendResponse(url)
      requestSignal = init.signal as AbortSignal
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        controller.abort()
      })
    })
    await expect(createLocalImageModel(BASE).paint(params, controller.signal)).rejects.toMatchObject({
      name: 'AbortError', message: expect.stringContaining('server may continue'),
    })
    expect(requestSignal?.aborted).toBe(true)
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/sdapi/v1/sd-models`, `${BASE}/sdapi/v1/samplers`, `${BASE}/sdcpp/v1/models/status`, `${BASE}/sdapi/v1/txt2img`,
    ])
  })

  it('discards late results even if transport ignores cancellation', async () => {
    const controller = new AbortController()
    const callback = vi.fn()
    mocks.fetch.mockImplementation((url) => {
      if (url.endsWith('/txt2img')) controller.abort()
      return backendResponse(url)
    })
    await expect(createLocalImageModel(BASE).paint(params, controller.signal, callback))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(callback).not.toHaveBeenCalled()
  })
})

describe('image generation actions internal routing', () => {
  it('snapshots persistent defaults without changing them when a temporary model is selected', async () => {
    const { useLocalImageBackendStore } = await import('@/stores/localImageBackendStore')
    useLocalImageBackendStore.getState().setConfig({ url: BASE, defaultModelId: 'default-model', steps: 5 })
    const { startImageGeneration } = await import('@/stores/imageGenerationActions')
    mocks.start.mockResolvedValueOnce({ recordId: 'temporary' })
    await startImageGeneration({ prompt: 'test', referenceImages: [], model: { provider: LOCAL_IMAGE_BACKEND_ID, modelId: 'local-checkpoint' } })
    expect(mocks.start).toHaveBeenCalledWith({ prompt: 'test', referenceImages: [], model: {
      provider: LOCAL_IMAGE_BACKEND_ID, modelId: 'local-checkpoint', localBackend: { url: BASE, steps: 5 },
    } }, {})
    expect(useLocalImageBackendStore.getState()).toMatchObject({ url: BASE, defaultModelId: 'default-model', steps: 5 })
  })

  it('bypasses general providers, catalog, settings, and license; persists canonical endpoint identity', async () => {
    const { getImageGenerationService, startImageGeneration } = await import('@/stores/imageGenerationActions')
    getImageGenerationService()
    const options = mocks.options!
    const model = { provider: LOCAL_IMAGE_BACKEND_ID, modelId: BASE }
    await expect(options.createModel(model)).resolves.toEqual({ paint: expect.any(Function) })
    await options.validateRequest?.({ prompt: 'test', referenceImages: [], model }, new AbortController().signal)
    expect(mocks.getModel).not.toHaveBeenCalled()
    expect(mocks.capabilities).not.toHaveBeenCalled()
    expect(mocks.settings).not.toHaveBeenCalled()
    expect(mocks.config).not.toHaveBeenCalled()
    mocks.start.mockResolvedValueOnce({ recordId: 'local-image' })
    await startImageGeneration({ prompt: 'test', referenceImages: [], model: { ...model, modelId: `${BASE}///` } })
    expect(mocks.start).toHaveBeenCalledWith({ prompt: 'test', referenceImages: [], model: {
      provider: LOCAL_IMAGE_BACKEND_ID, modelId: 'local-checkpoint', localBackend: { url: BASE, steps: 20 },
    } }, {})
    mocks.fetch.mockClear()
    await expect(options.validateRequest?.({ prompt: 'test', referenceImages: ['a', 'b'], model }, new AbortController().signal))
      .rejects.toThrow(/only one reference/)
    expect(mocks.fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
  })
})