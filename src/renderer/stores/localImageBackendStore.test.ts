import { beforeEach, expect, it, vi } from 'vitest'
const { saved } = vi.hoisted(() => ({ saved: new Map<string, unknown>() }))
vi.mock('./safeStorage', () => ({ getSafeStorage: () => ({
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: unknown) => saved.set(key, JSON.parse(JSON.stringify(value))),
  removeItem: (key: string) => saved.delete(key),
}) }))
import { useLocalImageBackendStore as store } from './localImageBackendStore'

beforeEach(() => {
  saved.clear()
  store.setState({ url: '', defaultModelId: '', steps: 20 })
})

it('hydrates a fresh install with no backend or model and the default steps', async () => {
  saved.clear()
  await store.persist.rehydrate()
  expect(store.getState()).toMatchObject({ url: '', defaultModelId: '', steps: 20 })
})

it('persists defaults separately and hydrates them', async () => {
  store.getState().setConfig({ url: 'http://localhost:1234/', defaultModelId: 'chosen', steps: 6 })
  const persisted = saved.get('local-image-backend')
  expect(persisted).toEqual({ state: { url: 'http://localhost:1234', defaultModelId: 'chosen', steps: 6 }, version: 1 })
  store.setState({ url: '', defaultModelId: '', steps: 20 })
  saved.set('local-image-backend', persisted)
  await store.persist.rehydrate()
  expect(store.getState()).toMatchObject({ url: 'http://localhost:1234', defaultModelId: 'chosen', steps: 6 })
})

it('validates atomic updates and provides dedicated default/steps setters', () => {
  store.getState().setDefaultModelId('default')
  store.getState().setSteps(1)
  expect(() => store.getState().setConfig({ url: 'http://user:pass@host', steps: 7 })).toThrow(/URL/)
  store.getState().setSteps(40)
  expect(store.getState().steps).toBe(40)
  expect(() => store.getState().setSteps(41)).toThrow(/1 to 40/)
  expect(store.getState()).toMatchObject({ url: '', defaultModelId: 'default', steps: 40 })
})