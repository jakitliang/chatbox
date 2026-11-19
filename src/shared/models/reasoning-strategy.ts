import { type ProviderOptions, ProviderOptionsSchema } from '../types'
import type { ReasoningControlLevel, ReasoningControlOption } from '../utils/reasoning-control'

/** Internal policy shared by model adapters with the same reasoning protocol. */
export interface ReasoningStrategy {
  getOptions(): ReasoningControlOption[]
  readLevel(options: ProviderOptions | undefined): ReasoningControlLevel
  writeOptions(level: ReasoningControlLevel, previous?: ProviderOptions): ProviderOptions | undefined
  normalizeOptions(options: ProviderOptions | undefined): ProviderOptions | undefined
}

const reasoningOptionKeys = ProviderOptionsSchema.keyof().options

export function stripReasoningProviderOptions(options: ProviderOptions | undefined): ProviderOptions | undefined {
  if (!options) return options
  const next = { ...options }
  let changed = false
  for (const key of reasoningOptionKeys) {
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

export const passthroughReasoningStrategy: ReasoningStrategy = {
  ...compatibleBooleanReasoningStrategy,
  normalizeOptions: (options) => options,
}

const effortLevels = ['low', 'medium', 'high'] as const

export function createReasoningStrategy({
  off = true,
  toggle = false,
  read,
  write,
}: {
  off?: boolean
  toggle?: boolean
  read: ReasoningStrategy['readLevel']
  write: (level: Exclude<ReasoningControlLevel, 'default'>, previous?: ProviderOptions) => ProviderOptions
}): ReasoningStrategy {
  const options = compatibleBooleanReasoningStrategy.getOptions().flatMap((option): ReasoningControlOption[] => {
    if (option.level === 'off' && !off) return []
    if (option.label === 'on' && !toggle) return effortLevels.map((level) => ({ level, label: level }))
    return [option]
  })
  return {
    getOptions: () => options,
    readLevel: read,
    writeOptions: (level, previous) =>
      level === 'default' || (level === 'off' && !off)
        ? stripReasoningProviderOptions(previous)
        : write(level, previous),
    normalizeOptions: (options) => options,
  }
}

export function readReasoningEffort(effort?: string): ReasoningControlLevel {
  if (!effort) return 'default'
  if (effort === 'none' || effort === 'minimal') return 'off'
  return effort === 'low' || effort === 'medium' ? effort : 'high'
}
