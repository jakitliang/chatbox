import type { Message, ProviderOptions } from '../types'

export interface ReasoningReplayPolicy {
  preserveReasoning: false | 'all-turns'
  signedReasoningOnly: boolean
  replayNamespaces: readonly string[]
  reasoningReplaySource?: string
  portable?: boolean
  ensureGoogleFunctionCallSignatures?: boolean
}

export interface ReasoningHistoryInput {
  mode: 'agent' | 'portable'
  lastMessage?: Message
  providerOptions?: ProviderOptions
}

export interface ReasoningHistoryPreparation {
  conversion: Partial<ReasoningReplayPolicy>
  providerOptions?: ProviderOptions
}

export const noReasoningReplay: ReasoningReplayPolicy = {
  preserveReasoning: false,
  signedReasoningOnly: false,
  replayNamespaces: [],
}

export const textReasoningReplay: ReasoningReplayPolicy = {
  ...noReasoningReplay,
  preserveReasoning: 'all-turns',
}

export function signedReasoningReplay(
  namespace: string,
  options?: Pick<ReasoningReplayPolicy, 'reasoningReplaySource' | 'portable' | 'ensureGoogleFunctionCallSignatures'>
): ReasoningReplayPolicy {
  return {
    preserveReasoning: 'all-turns',
    signedReasoningOnly: true,
    replayNamespaces: [namespace],
    ...options,
  }
}

export function prepareReasoningHistory(
  policy: ReasoningReplayPolicy,
  input: ReasoningHistoryInput
): ReasoningHistoryPreparation {
  const { portable, ...conversion } = policy
  return {
    conversion: input.mode === 'portable' && !portable ? {} : conversion,
    providerOptions: input.providerOptions,
  }
}
