import { noReasoningReplay } from '../../../models/reasoning-replay'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { openAIReasoning } from './openai-reasoning'
import OpenAIResponses from './openai-responses'

interface Options {
  apiKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
}

export default class XAI extends OpenAIResponses {
  protected getReasoningReplayPolicy() {
    return noReasoningReplay
  }

  protected getReasoningStrategy() {
    return openAIReasoning(this.modelId, {
      offEffort: 'none',
      onOptions: { include: ['reasoning.encrypted_content'] },
    })
  }

  public name = 'xAI'
  constructor(options: Options, dependencies: ModelDependencies) {
    const apiHost = 'https://api.x.ai/v1'
    super(
      {
        apiKey: options.apiKey,
        apiHost,
        apiPath: '/responses',
        model: options.model,
        temperature: options.temperature,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
        stream: options.stream,
      },
      dependencies
    )
  }
}
