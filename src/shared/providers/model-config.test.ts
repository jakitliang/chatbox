import { describe, expect, it } from 'vitest'
import type { ProviderModelInfo } from '../types'
import { mergeProviderModelCapabilities, refreshProviderModelCapabilities } from './model-config'

describe('mergeProviderModelCapabilities', () => {
  const defaultModel: ProviderModelInfo = {
    modelId: 'deepseek-v4-flash',
    nickname: 'DeepSeek V4 Flash',
    capabilities: ['reasoning', 'tool_use'],
    contextWindow: 1_000_000,
    maxOutput: 384_000,
  }

  it('does not silently restore capabilities missing from a persisted model record', () => {
    expect(
      mergeProviderModelCapabilities(
        {
          modelId: 'deepseek-v4-flash',
          type: 'chat',
          contextWindow: 128_000,
        },
        defaultModel
      )
    ).toEqual({
      modelId: 'deepseek-v4-flash',
      type: 'chat',
      contextWindow: 128_000,
    })
  })

  it('preserves explicit user capability overrides', () => {
    const storedModel: ProviderModelInfo = {
      modelId: 'deepseek-v4-flash',
      capabilities: [],
      contextWindow: 128_000,
    }

    expect(mergeProviderModelCapabilities(storedModel, defaultModel)).toBe(storedModel)
  })

  it('leaves custom models without built-in defaults unchanged', () => {
    const customModel: ProviderModelInfo = { modelId: 'custom-model', capabilities: ['tool_use'] }

    expect(mergeProviderModelCapabilities(customModel, undefined)).toBe(customModel)
  })

  it('refreshes a published maximum independently without overwriting the budget window', () => {
    const saved: ProviderModelInfo = { modelId: 'local', contextWindow: 8192, capabilities: ['vision'] }
    expect(refreshProviderModelCapabilities([saved], [{ modelId: 'local', maxContextWindow: 131072 }])).toEqual([
      { ...saved, maxContextWindow: 131072 },
    ])
    expect(saved.maxContextWindow).toBeUndefined()
  })
})
