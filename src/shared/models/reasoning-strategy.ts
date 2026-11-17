import type { ProviderModelInfo, ProviderOptions } from '../types'
import type {
  ReasoningControlCapabilities,
  ReasoningControlLevel,
  ReasoningControlOption,
} from '../utils/reasoning-control'

/** Pure control policy shared by the model adapter and its provider definition. */
export interface ReasoningStrategy {
  getCapabilities(model: ProviderModelInfo): ReasoningControlCapabilities | undefined
  getOptions(): ReasoningControlOption[]
  readLevel(options: ProviderOptions | undefined): ReasoningControlLevel
  writeOptions(level: ReasoningControlLevel, previous?: ProviderOptions): ProviderOptions | undefined
  normalizeOptions(options: ProviderOptions | undefined): ProviderOptions | undefined
}

const REASONING_NAMESPACES = [
  'claude',
  'openai',
  'google',
  'deepseek',
  'openaiCompatible',
  'openrouter',
] as const satisfies readonly (keyof ProviderOptions)[]

export function stripReasoningProviderOptions(options: ProviderOptions | undefined): ProviderOptions | undefined {
  if (!options) return options
  const next = { ...options }
  let changed = false
  for (const key of REASONING_NAMESPACES) {
    if (next[key] !== undefined) {
      delete next[key]
      changed = true
    }
  }
  return changed ? (Object.keys(next).length ? next : undefined) : options
}

function withThinking(options: ProviderOptions | undefined, enabled: boolean | undefined): ProviderOptions | undefined {
  const next = stripReasoningProviderOptions(options)
  return enabled === undefined ? next : { ...next, openaiCompatible: { enable_thinking: enabled } }
}

export const compatibleBooleanReasoningStrategy: ReasoningStrategy = {
  getCapabilities(model) {
    return model.capabilities?.includes('reasoning')
      ? { supported: true, kind: 'compatible-toggle' }
      : { supported: false, kind: 'toggle' }
  },
  getOptions: () => [
    { level: 'default', label: 'default' },
    { level: 'off', label: 'off' },
    { level: 'high', label: 'on' },
  ],
  readLevel(options) {
    const enabled = options?.openaiCompatible?.enable_thinking
    return enabled === undefined ? 'default' : enabled ? 'high' : 'off'
  },
  writeOptions: (level, previous) => withThinking(previous, level === 'default' ? undefined : level !== 'off'),
  normalizeOptions: (options) => withThinking(options, options?.openaiCompatible?.enable_thinking),
}
