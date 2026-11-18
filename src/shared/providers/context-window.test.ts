import { afterEach, describe, expect, it, vi } from 'vitest'
import { enrichModelFromRegistry, setRuntimeRegistry } from '../model-registry/enrich'
import type { ModelMetadata } from '../model-registry/types'
import { ModelProviderType } from '../types'
import {
  defaultMaxContextWindowDelegate,
  getContextWindow,
  getMaxContextWindow,
  getRuntimeContextWindowValue,
} from './context-window'
import { defineProvider } from './registry'

const meta = (contextWindow: number): ModelMetadata => ({
  modelId: 'capacity-fixture',
  name: 'Capacity fixture',
  type: 'chat',
  capabilities: [],
  contextWindow,
  maxOutput: 8192,
})

afterEach(() => {
  setRuntimeRegistry(null)
})

describe('provider capacity policies', () => {
  it.each(['ollama', 'fastflowlm'])('keeps %s unresolved without importing the chat runtime', (providerId) => {
    expect(getContextWindow({ providerId, modelId: 'unloaded' })).toEqual({ tokens: null, source: 'unknown' })
  })
  it('keeps the configured budget window separate from the published maximum', () => {
    setRuntimeRegistry({ 'capacity-online': { 'capacity-fixture': meta(262144) } })
    const input = {
      providerId: 'capacity-online',
      modelId: 'capacity-fixture',
      model: { modelId: 'capacity-fixture', contextWindow: 32768 },
    }
    expect(getContextWindow(input)).toEqual({ tokens: 32768, source: 'configuration' })
    expect(getMaxContextWindow(input)).toBe(262144)
    expect(enrichModelFromRegistry(input.model, input.providerId)).toMatchObject({
      contextWindow: 32768,
      maxContextWindow: 262144,
    })
  })

  it('falls back to the maximum only inside the default budget policy', () => {
    const input = {
      providerId: 'capacity-custom',
      modelId: 'private-model',
      model: { modelId: 'private-model', maxContextWindow: 65536, maxOutput: 1024 },
    }
    expect(getContextWindow(input)).toEqual({ tokens: 65536, source: 'catalog' })
    expect(getMaxContextWindow(input)).toBe(65536)
  })

  it('does not present a budget estimate as a model maximum', () => {
    const input = { providerId: 'capacity-custom', modelId: 'completely-unknown-capacity-fixture' }
    expect(getContextWindow(input)).toEqual({ tokens: 128000, source: 'fallback' })
    expect(getMaxContextWindow(input)).toBeUndefined()
  })

  it('keeps runtime unknown authoritative and makes specification lookup network-free', () => {
    const resolve = vi.fn()
    defineProvider({
      id: 'capacity-runtime-fixture',
      name: 'Runtime fixture',
      type: ModelProviderType.OpenAI,
      createModel: () => {
        throw new Error('Capacity lookup must not construct chat models')
      },
      contextWindowDelegate: {
        getContextWindow: getRuntimeContextWindowValue,
        runtime: { getCacheKey: () => 'fixture', resolve },
      },
    })
    const input = {
      providerId: 'capacity-runtime-fixture',
      modelId: 'private-model',
      model: { modelId: 'private-model', contextWindow: 131072, maxContextWindow: 262144 },
    }
    expect(getContextWindow(input)).toEqual({ tokens: null, source: 'unknown' })
    expect(getContextWindow({ ...input, runtimeContextWindow: 8192 })).toEqual({ tokens: 8192, source: 'runtime' })
    expect(getMaxContextWindow(input)).toBe(262144)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('allows provider-owned maximum and effective capacity implementations', () => {
    defineProvider({
      id: 'capacity-special-fixture',
      name: 'Special fixture',
      type: ModelProviderType.OpenAI,
      createModel: () => {
        throw new Error('Not used')
      },
      contextWindowDelegate: { getContextWindow: () => ({ tokens: 12000, source: 'configuration' }) },
      maxContextWindowDelegate: { getMaxContextWindow: () => 48000 },
    })
    const input = { providerId: 'capacity-special-fixture', modelId: 'special' }
    expect(getContextWindow(input).tokens).toBe(12000)
    expect(getMaxContextWindow(input)).toBe(48000)
  })

  it.each([0, -1, 0.5, Infinity, NaN])('ignores invalid configured capacities (%s)', (contextWindow) => {
    const input = {
      providerId: 'capacity-custom',
      modelId: 'private-model',
      model: { modelId: 'private-model', contextWindow, maxContextWindow: 16384 },
    }
    expect(getContextWindow(input).tokens).toBe(16384)
    expect(defaultMaxContextWindowDelegate.getMaxContextWindow(input)).toBe(16384)
  })
})
