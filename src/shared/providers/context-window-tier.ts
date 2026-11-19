export const contextWindowTiers = ['default', 'quarter', 'half', 'three-quarters', 'maximum'] as const
export type ContextWindowTier = (typeof contextWindowTiers)[number]
