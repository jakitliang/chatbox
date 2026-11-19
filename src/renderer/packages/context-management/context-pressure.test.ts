import { describe, expect, it, vi } from 'vitest'
import {
  getConfiguredContextWindow,
  getEffectiveMaxOutputTokens,
  resolveModelCompactionBudget,
} from './context-pressure'
import { getCompactionBudget } from '@chatbox/core/application/token-estimation/math'
import * as registry from '@shared/providers/registry'
import { ModelProviderType } from '@shared/types'

vi.mock('@/utils/request', () => ({ apiRequest: { get: vi.fn() } }))

it('budgets an explicit local target, but ignores a snapshot for a different model or provider', async () => {
  const providerId = 'fastflowlm'
  const modelId = 'local-model'
  const override = { providerId, modelId, tokens: 8192 }
  const getDefinition = vi.spyOn(registry, 'getProviderDefinition')
  getDefinition.mockImplementation((id) =>
    id === providerId
      ? {
          id: providerId,
          name: 'Local test provider',
          type: ModelProviderType.OpenAI,
          createModel: () => {
            throw new Error('Model instantiation is not expected')
          },
          contextWindowDelegate: {
            getContextWindow: () => ({ tokens: 32768, source: 'runtime' }),
            control: { getTarget: () => 8192, wrapFetch: (fetch) => fetch },
          },
        }
      : undefined
  )
  try {
    const settings = { compactionThreshold: 0.6 }
    await expect(resolveModelCompactionBudget(settings, providerId, modelId, 512, override)).resolves.toEqual(
      getCompactionBudget(8192, { ...settings, maxOutputTokens: 512 })
    )
    await expect(resolveModelCompactionBudget(settings, providerId, 'different', 512, override)).resolves.toEqual(
      getCompactionBudget(32768, { ...settings, maxOutputTokens: 512 })
    )
    const cloud = { ...settings, providers: { openai: { models: [{ modelId, contextWindow: 16384 }] } } }
    await expect(
      resolveModelCompactionBudget(cloud, 'openai', modelId, 512, { ...override, providerId: 'openai' })
    ).resolves.toEqual(getCompactionBudget(16384, { ...settings, maxOutputTokens: 512 }))
  } finally {
    getDefinition.mockRestore()
  }
})

describe('getConfiguredContextWindow', () => {
  it('reads the matching provider model window', () => {
    expect(
      getConfiguredContextWindow(
        {
          providers: {
            openai: {
              models: [{ modelId: 'gpt-4o', contextWindow: 128_000 }],
            },
          },
        },
        'openai',
        'gpt-4o'
      )
    ).toBe(128_000)
  })

  it('resolves a missing saved model through the shared policy', () => {
    expect(getConfiguredContextWindow({}, 'openai', 'gpt-4o')).toBeGreaterThan(0)
    expect(getConfiguredContextWindow({}, undefined, undefined)).toBeUndefined()
  })
})

describe('getEffectiveMaxOutputTokens', () => {
  const settings = {
    providers: {
      'custom-compaction-budget': {
        models: [{ modelId: 'custom-budget-model', maxOutput: 4096 }],
      },
    },
  }

  it('prefers the session reply limit over the configured model output', () => {
    expect(getEffectiveMaxOutputTokens(settings, 'custom-compaction-budget', 'custom-budget-model', 2048)).toBe(2048)
  })

  it('uses the configured output when no session limit is set', () => {
    expect(getEffectiveMaxOutputTokens(settings, 'custom-compaction-budget', 'custom-budget-model', undefined)).toBe(
      4096
    )
  })

  it('leaves unknown model output to the budget fallback', () => {
    expect(
      getEffectiveMaxOutputTokens({}, 'custom-compaction-budget', 'custom-budget-model', undefined)
    ).toBeUndefined()
    expect(getEffectiveMaxOutputTokens({}, undefined, undefined, undefined)).toBeUndefined()
  })
})
