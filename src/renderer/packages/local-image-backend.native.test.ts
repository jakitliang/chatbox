import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageGenerationModelSchema } from '@shared/types/image-generation'
import { createLocalImageModel, getLocalImageModels, resolveLocalImageJob } from './local-image-backend'

const { fetch } = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/adapters', () => ({ createModelDependencies: async () => ({ request: { fetchWithOptions: fetch } }) }))
const url = 'http://localhost:1234'
const file = 'checkpoints/v1-5-pruned.safetensors'
const second = 'checkpoints/sd15-other.safetensors'
const png = 'aGVsbG8='
const json = (value: unknown) => new Response(JSON.stringify(value))
let state: { state: string; recipe: string; models: Record<string, string>; revision: number }
let recipes: object[]
let files: object[]
const sd1 = { id: 'sd1-checkpoint', name: 'SD1', slots: [{ id: 'model', required: true, categories: ['checkpoints'] }], effective_features: { img2img: true }, defaults: { width: 512, cfg_scale: 7 } }

beforeEach(() => {
  state = { state: 'ready', recipe: sd1.id, models: { model: file }, revision: 1 }
  recipes = [sd1, { ...sd1, id: 'sdxl-checkpoint', name: 'SDXL' }, {
    id: 'flux1-dev', slots: [{ id: 'diffusion_model', required: true, categories: ['diffusion_models'] }, { id: 'clip_l', required: true, categories: ['text_encoders'] }],
  }]
  files = [file, second].map((id) => ({ id, name: id.split('/').pop(), category: 'checkpoints' }))
  fetch.mockReset().mockImplementation(async (endpoint: string, init: RequestInit) => {
    if (endpoint.endsWith('/sd-models')) return json([{ model_name: 'loaded' }])
    if (endpoint.endsWith('/samplers')) return json([{ name: 'Euler' }])
    if (endpoint.endsWith('/models/status')) return json(state)
    if (endpoint.endsWith('/recipes')) return json({ recipes })
    if (endpoint.endsWith('/model-files')) return json({ files })
    if (endpoint.endsWith('/models/load')) {
      const body = JSON.parse(String(init.body))
      state = { ...state, ...body, revision: state.revision + 1 }
      return json(state)
    }
    return json({ images: [png] })
  })
})

describe('native local drawing integration', () => {
  it('keeps recipe titles separate from checkpoint detail descriptions', async () => {
    const discovery = await getLocalImageModels(url)
    const loaded = discovery.models.find((model) => model.loaded)!
    expect(loaded.name).toBe('SD1')
    expect(loaded.description).toBe('v1-5-pruned.safetensors')
  })

  it('lists only compatible installed configurations and includes loaded auxiliaries', async () => {
    state.models.vae = 'vae/custom.safetensors'
    const discovery = await getLocalImageModels(url)
    expect(discovery.models.every((m) => m.recipe === sd1.id)).toBe(true)
    expect(discovery.models.some((m) => m.loaded && m.models?.vae === state.models.vae)).toBe(true)
    expect(fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
  })

  it('discovers runnable installed models even with no currently loaded checkpoint', async () => {
    state = { state: 'empty', recipe: '', models: {}, revision: 0 }
    fetch.mockImplementationOnce(() => json([]))
    const discovery = await getLocalImageModels(url)
    expect(discovery.models).toHaveLength(2)
    expect(discovery.currentModelId).toBeUndefined()
  })

  it('requires all mandatory slots and required_any groups', async () => {
    recipes = [{ ...sd1, required_any: [['vae', 'tae']], slots: [...sd1.slots, { id: 'vae', required: false, categories: ['vae'] }] }]
    state = { state: 'empty', recipe: '', models: {}, revision: 0 }
    expect((await getLocalImageModels(url)).models).toEqual([])
  })

  it('loads the exact native payload only when different, then uses snapshotted steps', async () => {
    const discovery = await getLocalImageModels(url)
    const chosen = discovery.models.find((m) => m.models?.model === second)!
    fetch.mockClear()
    await createLocalImageModel(url, chosen.id, 4).paint({ prompt: 'cat', num: 1 })
    const loads = fetch.mock.calls.filter(([endpoint]) => endpoint.endsWith('/models/load'))
    expect(loads).toHaveLength(1)
    expect(JSON.parse(loads[0][1].body)).toEqual({ recipe: sd1.id, models: { model: second } })
    const post = fetch.mock.calls.find(([endpoint]) => endpoint.endsWith('/txt2img'))!
    expect(JSON.parse(post[1].body)).toMatchObject({ steps: 4, n_iter: 1, batch_size: 1 })
    expect(post[1].body).not.toContain('override_settings')
    fetch.mockClear()
    await createLocalImageModel(url, chosen.id).paint({ prompt: 'cat', num: 1 })
    expect(fetch.mock.calls.some(([endpoint]) => endpoint.endsWith('/models/load'))).toBe(false)
  })

  it('does not silently substitute a missing selected model', async () => {
    await expect(createLocalImageModel(url, 'missing').paint({ prompt: 'cat', num: 1 })).rejects.toThrow(/not installed/)
    expect(fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
  })

  it('restricts SD1 to one reference at runtime', async () => {
    await expect(createLocalImageModel(url).paint({ prompt: 'cat', num: 1, images: [1, 2].map(() => ({ imageUrl: `data:image/png;base64,${png}` })) })).rejects.toThrow(/only one reference/)
    expect(fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
  })

  it('maps model-advertised multi-reference support to native SDAPI extra_images', async () => {
    recipes = [{ ...sd1, effective_features: { ref_images: true } }]
    const images = [1, 2].map(() => ({ imageUrl: `data:image/png;base64,${png}` }))
    await createLocalImageModel(url).paint({ prompt: 'cat', num: 1, images })
    const post = fetch.mock.calls.find(([endpoint]) => endpoint.endsWith('/txt2img'))!
    expect(JSON.parse(post[1].body).extra_images).toEqual(images.map((i) => i.imageUrl))
    expect(JSON.parse(post[1].body).init_images).toBeUndefined()
  })

  it('discards results after external model revision changes', async () => {
    const base = fetch.getMockImplementation()!
    fetch.mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('/txt2img')) state.revision++
      return base(...args)
    })
    const callback = vi.fn()
    await expect(createLocalImageModel(url).paint({ prompt: 'cat', num: 1 }, undefined, callback)).rejects.toThrow(/changed during generation/)
    expect(callback).not.toHaveBeenCalled()
  })

  it('handles structured adapter 404s but does not hide native errors', async () => {
    const base = fetch.getMockImplementation()!
    fetch.mockImplementation((endpoint, init) => endpoint.endsWith('/models/status') ? Promise.reject(Object.assign(new Error('not found'), { statusCode: 404 })) : base(endpoint, init))
    expect((await getLocalImageModels(url)).native).toBe(false)
    fetch.mockImplementation((endpoint, init) => endpoint.endsWith('/models/status') ? Promise.reject(Object.assign(new Error('denied'), { statusCode: 403 })) : base(endpoint, init))
    await expect(getLocalImageModels(url)).rejects.toThrow(/denied/)
  })

  it('preserves new snapshots through Zod and accepts legacy URL-only records', () => {
    const old = { provider: 'local-sdapi', modelId: url }
    expect(ImageGenerationModelSchema.parse(old)).toEqual(old)
    expect(resolveLocalImageJob(old)).toEqual({ url, steps: 20 })
    const model = { ...old, modelId: 'native-selection', localBackend: { url, steps: 3 } }
    expect(ImageGenerationModelSchema.parse(model)).toEqual(model)
    expect(resolveLocalImageJob(model)).toEqual({ url, steps: 3, modelId: model.modelId })
  })

  it.each([0, 41, 1.5, NaN])('rejects invalid steps %s before requests', (steps) => {
    expect(() => createLocalImageModel(url, undefined, steps)).toThrow(/1 to 40/)
    expect(fetch).not.toHaveBeenCalled()
  })
})