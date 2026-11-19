import { describe, expect, it, vi } from 'vitest'
import { newConfigs } from '../defaults'
import { stripReasoningProviderOptions } from '../models/reasoning-strategy'
import { isDeepSeekReasoningModel } from '../models/utils/deepseek'
import { getModel } from '../providers'
import {
  isClaudeAdaptiveThinkingModel,
  normalizeClaudeReasoningOptions,
  usesClaudeEffortControl,
} from '../providers/definitions/models/anthropic-reasoning'
import { shouldDisableClaudeThinkingForUnsignedResume } from '../providers/definitions/models/anthropic-reasoning-history'
import {
  getLegacyOpenAICompatibleThinkingType,
  getOpenAIReasoningEffort,
  isOpenAIReasoningEffortSupported,
  normalizeOpenAIReasoningOptions,
} from '../providers/definitions/models/openai-reasoning'
import { ModelProviderEnum, type ProviderModelInfo, ProviderOptionsSchema, type Settings } from '../types'
import type { ModelDependencies } from '../types/adapters'
import { resolveReasoningProviderOptions, setReasoningProviderOptionsForModel } from './reasoning-control'

const deps: ModelDependencies = {
  request: { apiRequest: vi.fn(), fetchWithOptions: vi.fn() },
  storage: { saveImage: vi.fn(), getImage: vi.fn() },
  sentry: { captureException: vi.fn(), withScope: vi.fn() },
  getRemoteConfig: vi.fn(),
}

function createModel(provider: ModelProviderEnum, modelId: string, reasoning = true) {
  const model: ProviderModelInfo = { modelId, capabilities: reasoning ? ['reasoning'] : [] }
  const settings = { providers: { [provider]: { apiKey: 'fixture', models: [model] } } } as Settings
  return getModel({ provider, modelId }, settings, newConfigs(), deps)
}

describe('reasoning-control', () => {
  it.each([
    [
      ModelProviderEnum.OpenAI,
      'gpt-5.5',
      ['default', 'off', 'low', 'medium', 'high'],
      { openai: { reasoningEffort: 'high', forceReasoning: true } },
      [],
    ],
    [
      ModelProviderEnum.OpenAI,
      'o3',
      ['default', 'low', 'medium', 'high'],
      { openai: { reasoningEffort: 'high', forceReasoning: true } },
      [],
    ],
    [
      ModelProviderEnum.Claude,
      'claude-sonnet-4-6',
      ['default', 'off', 'low', 'medium', 'high'],
      { claude: { thinking: { type: 'enabled', budgetTokens: 8192 } } },
      ['anthropic'],
    ],
    [
      ModelProviderEnum.Claude,
      'claude-opus-4-8',
      ['default', 'low', 'medium', 'high'],
      { claude: { effort: 'high' } },
      ['anthropic'],
    ],
    [
      ModelProviderEnum.Gemini,
      'gemini-2.5-flash',
      ['default', 'off', 'low', 'medium', 'high'],
      { google: { thinkingConfig: { thinkingBudget: 24576, includeThoughts: true } } },
      ['google'],
    ],
    [
      ModelProviderEnum.Gemini,
      'gemini-3-pro-preview',
      ['default', 'off', 'low', 'medium', 'high'],
      { google: { thinkingConfig: { thinkingLevel: 'high', includeThoughts: true } } },
      ['google'],
    ],
    [
      ModelProviderEnum.DeepSeek,
      'deepseek-v4-pro',
      ['default', 'off', 'low', 'medium', 'high'],
      { deepseek: { thinking: { type: 'enabled' }, reasoningEffort: 'max' } },
      [],
    ],
    [
      ModelProviderEnum.DeepSeek,
      'deepseek-reasoner',
      ['default', 'off', 'on'],
      { deepseek: { thinking: { type: 'enabled' } } },
      [],
    ],
    [
      ModelProviderEnum.Qwen,
      'qwen3.7-max',
      ['default', 'off', 'on'],
      { openaiCompatible: { enable_thinking: true } },
      [],
    ],
    [
      ModelProviderEnum.OpenRouter,
      'fixture',
      ['default', 'off', 'low', 'medium', 'high'],
      { openrouter: { reasoning: { effort: 'high', exclude: false } } },
      [],
    ],
  ] as const)(
    'uses the %s model instance for %s without provider arguments',
    (provider, id, labels, expected, namespaces) => {
      const model = createModel(provider, id)
      expect(model.getReasoningOptions?.().map(({ label }) => label)).toEqual(labels)
      const options = model.writeReasoningOptions?.('high')
      expect(options).toEqual(expected)
      expect(model.readReasoningLevel?.(options)).toBe('high')
      expect(model.writeReasoningOptions?.('default', options)).toBeUndefined()
      expect(model.prepareReasoningHistory?.({ mode: 'agent' }).conversion.replayNamespaces).toEqual(namespaces)
      expect(createModel(provider, id, false).getReasoningOptions?.()).toEqual([])
    }
  )

  it('isolates same-name model choices in different providers without using the provider to select behavior', () => {
    const modelId = 'same-name'
    const openai = createModel(ModelProviderEnum.OpenAI, modelId)
    const qwen = createModel(ModelProviderEnum.Qwen, modelId)
    const high = openai.writeReasoningOptions?.('high')
    const off = qwen.writeReasoningOptions?.('off')
    const saved = setReasoningProviderOptionsForModel(
      setReasoningProviderOptionsForModel(undefined, ModelProviderEnum.OpenAI, modelId, high),
      ModelProviderEnum.Qwen,
      modelId,
      off
    )
    expect(openai.readReasoningLevel?.(resolveReasoningProviderOptions(saved, ModelProviderEnum.OpenAI, modelId))).toBe(
      'high'
    )
    expect(qwen.readReasoningLevel?.(resolveReasoningProviderOptions(saved, ModelProviderEnum.Qwen, modelId))).toBe(
      'off'
    )
  })

  it('drops mismatched-generation Claude options at the request edge', () => {
    // Budget-style thinking persisted under a Sonnet session must not be sent to an
    // adaptive effort model after a model switch (and vice versa).
    expect(
      normalizeClaudeReasoningOptions('claude-opus-4-8', { thinking: { type: 'enabled', budgetTokens: 8192 } })
    ).toBeUndefined()
    expect(normalizeClaudeReasoningOptions('claude-opus-4-5', { effort: 'high' })).toEqual({ effort: 'high' })
    expect(normalizeClaudeReasoningOptions('claude-opus-5', { effort: 'high' })).toEqual({ effort: 'high' })
    expect(
      normalizeClaudeReasoningOptions('claude-opus-4-7', {
        effort: 'low',
        thinking: { type: 'enabled', budgetTokens: 1024 },
      })
    ).toEqual({ effort: 'low' })
    expect(normalizeClaudeReasoningOptions('claude-sonnet-4-6', { effort: 'high' })).toBeUndefined()
    expect(
      normalizeClaudeReasoningOptions('claude-sonnet-4-6', { thinking: { type: 'disabled', budgetTokens: 0 } })
    ).toEqual({ thinking: { type: 'disabled', budgetTokens: 0 } })
    expect(normalizeClaudeReasoningOptions('claude-sonnet-4-6', undefined)).toBeUndefined()
    expect(usesClaudeEffortControl('claude-opus-4-5')).toBe(true)
    expect(usesClaudeEffortControl('claude-opus-4-8')).toBe(true)
    expect(usesClaudeEffortControl('claude-opus-5')).toBe(true)
    expect(usesClaudeEffortControl('claude-sonnet-4-6')).toBe(false)
  })

  it('strips reasoning efforts the target OpenAI model rejects at the request edge', () => {
    // Stale GPT-5 off state (minimal/none) carried onto o-series via a model switch.
    expect(normalizeOpenAIReasoningOptions('o3', { reasoningEffort: 'minimal', forceReasoning: true })).toBeUndefined()
    expect(normalizeOpenAIReasoningOptions('o4-mini', { reasoningEffort: 'none' })).toBeUndefined()
    // Valid efforts pass through untouched for o-series and GPT-5 models.
    expect(normalizeOpenAIReasoningOptions('o3', { reasoningEffort: 'medium' })).toEqual({ reasoningEffort: 'medium' })
    expect(normalizeOpenAIReasoningOptions('gpt-5', { reasoningEffort: 'minimal', forceReasoning: true })).toEqual({
      reasoningEffort: 'minimal',
      forceReasoning: true,
    })
    // o1-preview/o1-mini reject the parameter entirely — everything is dropped.
    expect(normalizeOpenAIReasoningOptions('o1-preview', { reasoningEffort: 'medium' })).toBeUndefined()
    expect(normalizeOpenAIReasoningOptions('o1-mini', { reasoningSummary: 'auto' })).toBeUndefined()
    expect(normalizeOpenAIReasoningOptions('o1', { reasoningEffort: 'high' })).toEqual({ reasoningEffort: 'high' })
    expect(normalizeOpenAIReasoningOptions('gpt-5.1', undefined)).toBeUndefined()
    expect(isOpenAIReasoningEffortSupported('o3', 'minimal')).toBe(false)
    expect(isOpenAIReasoningEffortSupported('o3', 'high')).toBe(true)
    expect(isOpenAIReasoningEffortSupported('o1-preview', 'high')).toBe(false)
    expect(isOpenAIReasoningEffortSupported('gpt-5.1', 'none')).toBe(true)
  })

  it.each(['o1-preview', 'o1-mini', 'o1-preview-2024-09-12', 'openai/o1-mini-2024-09-12'])(
    'does not offer reasoning settings for legacy OpenAI model %s',
    (modelId) => {
      const model = createModel(ModelProviderEnum.OpenAI, modelId)
      const stale = { openai: { reasoningEffort: 'medium' as const, reasoningSummary: 'auto' as const } }
      expect(model.getReasoningOptions?.()).toEqual([])
      expect(model.readReasoningLevel?.(stale)).toBe('default')
      expect(model.writeReasoningOptions?.('high', stale)).toBeUndefined()
      expect(normalizeOpenAIReasoningOptions(modelId, stale.openai)).toBeUndefined()
    }
  )

  it('sends none-style off effort for all dotted gpt-5.x generations', () => {
    for (const id of ['gpt-5.1', 'gpt-5.2', 'gpt-5.3', 'gpt-5.4', 'gpt-5.5', 'gpt-5.10']) {
      expect(getOpenAIReasoningEffort(id, 'off')).toBe('none')
    }
    expect(getOpenAIReasoningEffort('gpt-5', 'off')).toBe('minimal')
    expect(getOpenAIReasoningEffort('gpt-5-mini', 'off')).toBe('minimal')
  })

  it('interprets legacy openaiCompatible reasoning options as a thinking toggle', () => {
    expect(getLegacyOpenAICompatibleThinkingType(undefined)).toBeUndefined()
    expect(getLegacyOpenAICompatibleThinkingType({})).toBeUndefined()
    expect(getLegacyOpenAICompatibleThinkingType({ enabled: true })).toBe('enabled')
    expect(getLegacyOpenAICompatibleThinkingType({ enabled: false })).toBe('disabled')
    expect(getLegacyOpenAICompatibleThinkingType({ exclude: true })).toBe('disabled')
    expect(getLegacyOpenAICompatibleThinkingType({ enabled: true, exclude: true })).toBe('disabled')
  })

  it('shares model-id matchers between capability detection and providers', () => {
    expect(isDeepSeekReasoningModel('deepseek-reasoner')).toBe(true)
    expect(isDeepSeekReasoningModel('deepseek/deepseek-r1:free')).toBe(true)
    expect(isDeepSeekReasoningModel('deepseek-v3.2-thinking')).toBe(true)
    expect(isDeepSeekReasoningModel('deepseek-chat')).toBe(false)
    expect(isClaudeAdaptiveThinkingModel('claude-opus-4-7')).toBe(true)
    expect(isClaudeAdaptiveThinkingModel('claude-opus-4-8')).toBe(true)
    expect(isClaudeAdaptiveThinkingModel('claude-opus-5')).toBe(true)
    expect(isClaudeAdaptiveThinkingModel('claude-opus-4-5')).toBe(false)
    // Dated ids keep matching; larger version numbers must not false-match.
    expect(isClaudeAdaptiveThinkingModel('claude-opus-4-7-20260115')).toBe(true)
    expect(isClaudeAdaptiveThinkingModel('claude-opus-5-20260601')).toBe(true)
    expect(isClaudeAdaptiveThinkingModel('claude-opus-4-70')).toBe(false)
    expect(isClaudeAdaptiveThinkingModel('claude-opus-50')).toBe(false)
    expect(usesClaudeEffortControl('claude-opus-4-5-20251101')).toBe(true)
    expect(usesClaudeEffortControl('claude-opus-4-50')).toBe(false)
  })

  describe('stripReasoningProviderOptions', () => {
    it('returns undefined/empty inputs unchanged', () => {
      expect(stripReasoningProviderOptions(undefined)).toBeUndefined()
      expect(stripReasoningProviderOptions({})).toEqual({})
    })

    it('removes all reasoning provider option namespaces', () => {
      expect(
        stripReasoningProviderOptions({
          openai: { reasoningEffort: 'none', forceReasoning: true },
        })
      ).toBeUndefined()
      expect(
        stripReasoningProviderOptions({
          claude: { thinking: { type: 'enabled', budgetTokens: 1024 } },
          google: { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } },
          openaiCompatible: { enable_thinking: true },
        })
      ).toBeUndefined()
    })

    it('clears every schema-defined namespace without dropping unrelated fields or mutating the input', () => {
      const namespaces = ProviderOptionsSchema.keyof().options
      const input = {
        ...Object.fromEntries(namespaces.map((key) => [key, {}])),
        unrelated: true,
        openai: { reasoningEffort: 'high' as const },
      }

      expect(stripReasoningProviderOptions(input)).toEqual({ unrelated: true })
      expect(Object.keys(input)).toEqual([...namespaces, 'unrelated'])
    })

    it('returns the same reference when there is nothing to strip', () => {
      const input = {}
      expect(stripReasoningProviderOptions(input)).toBe(input)
    })
  })

  describe('per-model reasoning provider options', () => {
    const deepseekOptions = { claude: { thinking: { type: 'enabled' as const }, effort: 'max' as const } }
    const claudeOptions = { claude: { thinking: { type: 'enabled' as const, budgetTokens: 4096 } } }

    it('scopes options to the provider+model they were written for', () => {
      const written = setReasoningProviderOptionsForModel(
        undefined,
        ModelProviderEnum.ChatboxAI,
        'deepseek-v4-pro',
        deepseekOptions
      )

      // The legacy shared field is cleared; the map is the single source of truth.
      expect(written.providerOptions).toBeUndefined()
      expect(written.providerOptionsByModel).toEqual({ 'chatbox-ai:deepseek-v4-pro': deepseekOptions })
      expect(resolveReasoningProviderOptions(written, ModelProviderEnum.ChatboxAI, 'deepseek-v4-pro')).toEqual(
        deepseekOptions
      )
      // A switched model must not inherit another model's parameters.
      expect(
        resolveReasoningProviderOptions(written, ModelProviderEnum.ChatboxAI, 'claude-sonnet-4-20250514')
      ).toBeUndefined()
      expect(resolveReasoningProviderOptions(written, ModelProviderEnum.OpenAI, 'gpt-5.5')).toBeUndefined()
    })

    it('keeps entries of other models and removes an entry on the default level', () => {
      const first = setReasoningProviderOptionsForModel(
        undefined,
        ModelProviderEnum.ChatboxAI,
        'deepseek-v4-pro',
        deepseekOptions
      )
      const second = setReasoningProviderOptionsForModel(
        first,
        ModelProviderEnum.ChatboxAI,
        'claude-sonnet-4-20250514',
        claudeOptions
      )

      expect(second.providerOptionsByModel).toEqual({
        'chatbox-ai:deepseek-v4-pro': deepseekOptions,
        'chatbox-ai:claude-sonnet-4-20250514': claudeOptions,
      })

      const cleared = setReasoningProviderOptionsForModel(
        second,
        ModelProviderEnum.ChatboxAI,
        'deepseek-v4-pro',
        undefined
      )
      expect(cleared.providerOptions).toBeUndefined()
      expect(cleared.providerOptionsByModel).toEqual({ 'chatbox-ai:claude-sonnet-4-20250514': claudeOptions })
      expect(resolveReasoningProviderOptions(cleared, ModelProviderEnum.ChatboxAI, 'deepseek-v4-pro')).toBeUndefined()
    })

    it('never reads the legacy shared field', () => {
      expect(
        resolveReasoningProviderOptions(
          { providerOptions: claudeOptions },
          ModelProviderEnum.Claude,
          'claude-sonnet-4-5'
        )
      ).toBeUndefined()
      expect(
        resolveReasoningProviderOptions(
          { providerOptions: claudeOptions, providerOptionsByModel: {} },
          ModelProviderEnum.Claude,
          'claude-sonnet-4-5'
        )
      ).toBeUndefined()
      expect(resolveReasoningProviderOptions(undefined, ModelProviderEnum.Claude, 'claude-sonnet-4-5')).toBeUndefined()
    })

    it('does not clear the dedicated Claude prompt cache TTL when reasoning changes', () => {
      const settings = {
        claudePromptCacheTTL: '1h' as const,
        providerOptions: claudeOptions,
      }

      const updated = {
        ...settings,
        ...setReasoningProviderOptionsForModel(settings, ModelProviderEnum.Claude, 'claude-sonnet-4-5', claudeOptions),
      }

      expect(updated.claudePromptCacheTTL).toBe('1h')
      expect(updated.providerOptions).toBeUndefined()
    })
  })

  describe('request-edge hardening for cross-model DeepSeek values', () => {
    it('drops enabled Claude thinking without budgetTokens on budget-style models', () => {
      // Shape only the DeepSeek-Anthropic writer produces; real Anthropic budget models
      // reject enabled thinking without budget_tokens.
      expect(
        normalizeClaudeReasoningOptions('claude-sonnet-4-20250514', { thinking: { type: 'enabled' }, effort: 'max' })
      ).toBeUndefined()
      expect(
        normalizeClaudeReasoningOptions('claude-sonnet-4-20250514', {
          thinking: { type: 'enabled', budgetTokens: 1024 },
        })
      ).toEqual({ thinking: { type: 'enabled', budgetTokens: 1024 } })
    })

    it('clamps DeepSeek-only Claude effort values on effort-style models', () => {
      expect(normalizeClaudeReasoningOptions('claude-opus-4-5', { effort: 'max' })).toEqual({ effort: 'high' })
      expect(normalizeClaudeReasoningOptions('claude-opus-4-8', { effort: 'xhigh' })).toEqual({ effort: 'high' })
    })

    it('rejects the DeepSeek-only max effort for OpenAI models', () => {
      expect(isOpenAIReasoningEffortSupported('gpt-5.5', 'max')).toBe(false)
      expect(
        normalizeOpenAIReasoningOptions('gpt-5.5', { reasoningEffort: 'max', forceReasoning: true })
      ).toBeUndefined()
    })
  })

  describe('shouldDisableClaudeThinkingForUnsignedResume', () => {
    const signed = {
      type: 'reasoning' as const,
      text: 'signed plan',
      providerMetadata: { anthropic: { signature: 'sig_1' } },
    }
    const redacted = {
      type: 'reasoning' as const,
      text: '',
      providerMetadata: { anthropic: { redactedData: 'encrypted' } },
      protocolOnly: true as const,
    }
    const unsigned = { type: 'reasoning' as const, text: 'foreign leftover' }
    const tool = (id: string, state: 'result' | 'error' | 'paused' = 'result') => ({
      type: 'tool-call' as const,
      toolCallId: id,
      toolName: 'run_code',
      args: {},
      state,
    })
    it('keeps thinking on when the resumed turn opens with signed thinking', () => {
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [signed, tool('t1')] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(false)
    })

    it('does not treat a leftover OpenAI reasoning item as signed Anthropic thinking', () => {
      // The Anthropic converter drops foreign-namespace metadata, so a block
      // carrying only an OpenAI item never reaches the wire: the resumed turn is
      // unsigned and must degrade instead of shipping a signature-less block.
      const openaiOnly = {
        type: 'reasoning' as const,
        text: 'openai thought',
        providerMetadata: { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' } },
      }
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [openaiOnly, tool('t1')] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(true)
    })

    it('keeps thinking on for non-interleaved multi-step turns where only the first step is signed', () => {
      // Documented shape: without interleaved thinking, Claude thinks once at
      // the start of the turn; later loop steps ship bare tool_use blocks.
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [signed, tool('t1'), tool('t2')] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(false)
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [signed, tool('t1'), unsigned, tool('t2')] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(false)
    })

    it('counts redacted thinking behind skipped protocol-only parts as a valid turn start', () => {
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          {
            role: 'assistant',
            contentParts: [{ type: 'text', text: '', protocolOnly: true }, redacted, tool('t1')],
          },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(false)
    })

    it('disables thinking when the resumed turn cannot open with signed thinking', () => {
      // Legacy data: reasoning text persisted without a signature.
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [unsigned, tool('t1')] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(true)
      // A turn minted by another provider starts with text or a bare tool call.
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [{ type: 'text', text: 'gpt narration' }, signed, tool('t1')] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(true)
    })

    it('never fires on fresh user turns, whatever the earlier history holds', () => {
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'user', contentParts: [{ type: 'text', text: 'new question' }] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(false)
      expect(shouldDisableClaudeThinkingForUnsignedResume(undefined, true, 'claude-haiku-4-5')).toBe(false)
    })

    it('requires a completed tool call before treating the tail as a resumed exchange', () => {
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [unsigned, tool('t1', 'paused')] },
          true,
          'claude-haiku-4-5'
        )
      ).toBe(false)
    })

    it('leaves effort/adaptive models untouched: the turn-start rule is manual-mode-only', () => {
      // Adaptive thinking drops the "turn must open with a thinking block"
      // requirement, and effort models never receive manual thinking config,
      // so an unsigned resume is already a valid request for them.
      for (const modelId of ['claude-opus-4-5', 'claude-opus-4-7', 'claude-opus-5']) {
        expect(
          shouldDisableClaudeThinkingForUnsignedResume(
            { role: 'assistant', contentParts: [unsigned, tool('t1')] },
            true,
            modelId
          )
        ).toBe(false)
      }
    })

    it('stays inert outside the signed replay channel', () => {
      expect(
        shouldDisableClaudeThinkingForUnsignedResume(
          { role: 'assistant', contentParts: [unsigned, tool('t1')] },
          false,
          'claude-haiku-4-5'
        )
      ).toBe(false)
    })
  })
})
