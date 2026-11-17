import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import { getOpenAICompatibleProviderOptionsKey } from '../../../models/openai-compatible'
import type { CallChatCompletionOptions } from '../../../models/types'
import { createOpenAIChatCompletionSseFetch } from '../../../models/utils/openai-chat-sse-termination'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

interface Options {
  apiKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
}

const Host = 'https://ark.cn-beijing.volces.com'
const Path = '/api/v3/chat/completions'

export default class VolcEngine extends AbstractAISDKModel {
  public name = 'VolcEngine'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getCallSettings(options: CallChatCompletionOptions) {
    const thinking = options.providerOptions?.openaiCompatible?.enable_thinking
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
      providerOptions:
        thinking === undefined
          ? undefined
          : {
              [getOpenAICompatibleProviderOptionsKey(this.name)]: {
                thinking: { type: thinking ? 'enabled' : 'disabled' },
              },
            },
    }
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider() {
    return createOpenAICompatible({
      name: this.name,
      apiKey: this.options.apiKey,
      baseURL: Host,
      fetch: createOpenAIChatCompletionSseFetch(async (_input, init) => fetch(`${Host}${Path}`, init)),
    })
  }
  protected getChatModel() {
    const provider = this.getProvider()
    return provider.chatModel(this.options.model.modelId)
  }
}
