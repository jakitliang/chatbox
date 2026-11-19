import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import type { ContextWindowControl } from '../providers/context-window-control'
import type { ProviderModelInfo } from '../types'
import type { ModelDependencies } from '../types/adapters'
import AbstractAISDKModel from './abstract-ai-sdk'
import { ApiError } from './errors'
import { textReasoningReplay } from './reasoning-replay'
import { compatibleBooleanReasoningStrategy, type ReasoningStrategy } from './reasoning-strategy'
import type { CallChatCompletionOptions, ModelInterface } from './types'
import { isDeepSeekReasoningModel } from './utils/deepseek'
import { createFetchWithProxy } from './utils/fetch-proxy'
import { createOpenAIChatCompletionSseFetch } from './utils/openai-chat-sse-termination'

export interface OpenAICompatibleSettings {
  apiKey: string
  apiHost: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  useProxy?: boolean
  maxOutputTokens?: number
  stream?: boolean
  customFetch?: typeof globalThis.fetch
  contextWindowControl?: ContextWindowControl
  listModelsFallback?: ProviderModelInfo[]
}

export default abstract class OpenAICompatible extends AbstractAISDKModel implements ModelInterface {
  protected getReasoningReplayPolicy() {
    return this.apiStyle === 'openai' && isDeepSeekReasoningModel(this.modelId)
      ? textReasoningReplay
      : super.getReasoningReplayPolicy()
  }

  protected getReasoningStrategy(): ReasoningStrategy {
    return compatibleBooleanReasoningStrategy
  }
  public name = 'OpenAI Compatible'

  constructor(
    public options: OpenAICompatibleSettings,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getCallSettings(options: CallChatCompletionOptions) {
    const openAICompatibleOptions = options.providerOptions?.openaiCompatible
    const providerOptions = openAICompatibleOptions
      ? {
          openaiCompatible: openAICompatibleOptions,
          [getOpenAICompatibleProviderOptionsKey(this.name)]: openAICompatibleOptions,
        }
      : undefined

    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
      providerOptions,
    }
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider(options?: CallChatCompletionOptions) {
    let fetch = this.options.customFetch || createFetchWithProxy(this.options.useProxy, this.dependencies)
    if (options?.contextWindowOverride && this.options.contextWindowControl) {
      fetch = this.options.contextWindowControl.wrapFetch(fetch, options.contextWindowOverride.tokens)
    }
    return createOpenAICompatible({
      name: this.name,
      apiKey: this.options.apiKey,
      baseURL: this.options.apiHost,
      fetch: createOpenAIChatCompletionSseFetch(fetch),
    })
  }

  protected getChatModel(options?: CallChatCompletionOptions) {
    const provider = this.getProvider(options)
    return wrapLanguageModel({
      model: provider.languageModel(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    return await fetchRemoteModels(
      {
        apiHost: this.options.apiHost,
        apiKey: this.options.apiKey,
        useProxy: this.options.useProxy,
        customFetch: this.options.customFetch,
      },
      this.dependencies
    ).catch((err) => {
      console.error(err)
      if (this.options.listModelsFallback) {
        return this.options.listModelsFallback
      }
      return []
    })
  }
}

export function getOpenAICompatibleProviderOptionsKey(name: string) {
  return name.split('.')[0].trim()
}

interface ListModelsResponse {
  object: 'list'
  data: {
    id: string
    object: 'model'
    created: number
    owned_by?: string
    // OpenRouter specific fields
    name?: string
    context_length?: number
    architecture?: {
      input_modalities?: string[]
      output_modalities?: string[]
      tokenizer?: string
    }
    pricing?: {
      prompt?: string
      completion?: string
      image?: string
      request?: string
      web_search?: string
      internal_reasoning?: string
    }
    top_provider?: {
      is_moderated?: boolean
    }
    canonical_slug?: string
    hugging_face_id?: string
    per_request_limits?: Record<string, unknown>
    supported_parameters?: string[]
  }[]
}

export async function fetchRemoteModels(
  params: {
    apiHost: string
    apiKey: string
    useProxy?: boolean
    extraHeaders?: Record<string, string>
    customFetch?: typeof globalThis.fetch
  },
  dependencies: ModelDependencies
) {
  const headers = {
    ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
    ...(params.extraHeaders || {}),
  }
  const response = params.customFetch
    ? await params.customFetch(`${params.apiHost}/models`, {
        method: 'GET',
        headers,
      })
    : await dependencies.request.apiRequest({
        url: `${params.apiHost}/models`,
        method: 'GET',
        headers,
        useProxy: params.useProxy,
      })
  const json: ListModelsResponse = await response.json()
  if (!json.data) {
    throw new ApiError(JSON.stringify(json))
  }
  return json.data.map((item) => {
    const modelInfo: ProviderModelInfo = {
      modelId: item.id,
      type: 'chat',
    }

    // Add nickname from OpenRouter name field
    if (item.name) {
      modelInfo.nickname = item.name
    }

    // Add context window if available
    if (item.context_length) {
      modelInfo.contextWindow = item.context_length
    }

    // Read each capability from its own metadata; parameter support does not require architecture.
    const capabilities: NonNullable<ProviderModelInfo['capabilities']> = []
    if (item.architecture?.input_modalities?.includes('image')) {
      capabilities.push('vision')
    }
    if (item.pricing?.web_search && item.pricing.web_search !== '0') {
      capabilities.push('web_search')
    }
    if (
      (item.pricing?.internal_reasoning && item.pricing.internal_reasoning !== '0') ||
      item.supported_parameters?.includes('reasoning') ||
      item.supported_parameters?.includes('include_reasoning') ||
      item.supported_parameters?.includes('reasoning_effort')
    ) {
      capabilities.push('reasoning')
    }
    if (item.supported_parameters?.includes('tools') || item.supported_parameters?.includes('tool_choice')) {
      capabilities.push('tool_use')
    }

    if (
      capabilities.length > 0 ||
      item.architecture !== undefined ||
      item.supported_parameters !== undefined ||
      item.pricing?.internal_reasoning !== undefined
    ) {
      modelInfo.capabilities = capabilities
    }

    return modelInfo
  })
}
