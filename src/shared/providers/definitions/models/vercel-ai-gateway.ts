import { createGatewayProvider } from '@ai-sdk/gateway'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import {
  type ReasoningHistoryInput,
  signedReasoningReplay,
  textReasoningReplay,
} from '../../../models/reasoning-replay'
import type { CallChatCompletionOptions } from '../../../models/types'
import { isDeepSeekReasoningModel } from '../../../models/utils/deepseek'
import { createFetchWithProxy } from '../../../models/utils/fetch-proxy'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { claudeReasoning } from './anthropic-reasoning'
import { prepareAnthropicReasoningHistory } from './anthropic-reasoning-history'
import { geminiReasoning } from './gemini-reasoning'
import { openAIReasoning } from './openai-reasoning'

interface Options {
  apiKey: string
  apiHost?: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  useProxy?: boolean
  stream?: boolean
}

export default class VercelAIGateway extends AbstractAISDKModel {
  protected getReasoningStrategy() {
    const [upstream] = this.modelId.split('/')
    if (this.apiStyle === 'anthropic' || upstream === 'anthropic') return claudeReasoning(this.modelId)
    if (this.apiStyle === 'google' || upstream === 'google') return geminiReasoning(this.modelId)
    return openAIReasoning(this.modelId)
  }

  protected getReasoningReplayPolicy() {
    if (this.apiStyle === 'google') {
      return signedReasoningReplay('google', { portable: true, ensureGoogleFunctionCallSignatures: true })
    }
    if (this.apiStyle === 'openai-responses') {
      return signedReasoningReplay('openai', { portable: true, reasoningReplaySource: this.reasoningReplaySource })
    }
    if (this.apiStyle === 'openai' && isDeepSeekReasoningModel(this.modelId)) return textReasoningReplay
    return super.getReasoningReplayPolicy()
  }

  public prepareReasoningHistory(input: ReasoningHistoryInput) {
    return this.apiStyle === 'anthropic'
      ? prepareAnthropicReasoningHistory(this.modelId, input)
      : super.prepareReasoningHistory(input)
  }

  public name = 'Vercel AI Gateway'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getCallSettings(options: CallChatCompletionOptions) {
    const { claude, openai, google } = options.providerOptions || {}
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
      providerOptions: {
        ...(claude ? { anthropic: claude } : {}),
        ...(openai ? { openai } : {}),
        ...(google ? { google } : {}),
      },
    }
  }

  protected getProvider() {
    return createGatewayProvider({
      apiKey: this.options.apiKey,
      ...(this.options.apiHost ? { baseURL: this.options.apiHost } : {}),
      fetch: createFetchWithProxy(this.options.useProxy, this.dependencies),
    })
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return provider.languageModel(this.options.model.modelId)
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    try {
      const provider = this.getProvider()
      const response = await provider.getAvailableModels()
      return response.models
        .filter((m) => !m.modelType || m.modelType === 'language')
        .map((m) => {
          const capabilities: ProviderModelInfo['capabilities'] = []

          // Infer capabilities from the underlying provider in the model ID
          const providerId = m.specification?.provider || m.id.split('/')[0]
          if (providerId) {
            const lower = providerId.toLowerCase()
            // Most gateway models support tool use
            if (!lower.includes('perplexity')) {
              capabilities.push('tool_use')
            }
            // Vision support for known providers
            if (['anthropic', 'openai', 'google', 'xai', 'meta'].some((p) => lower.includes(p))) {
              capabilities.push('vision')
            }
          }

          return {
            modelId: m.id,
            nickname: m.name,
            type: 'chat' as const,
            ...(capabilities.length > 0 ? { capabilities } : {}),
          }
        })
    } catch (err) {
      console.error('Failed to fetch Vercel AI Gateway models:', err)
      return []
    }
  }
}
