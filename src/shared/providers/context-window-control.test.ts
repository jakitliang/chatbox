import { describe, expect, it } from 'vitest'
import { SessionSettingsSchema } from '../types'
import { getContextWindowSelection, resolveSessionContextWindowOverride } from './context-window-control'
import './index'

const globalSettings = {
  providers: {
    ollama: { models: [{ modelId: 'local', maxContextWindow: 32768 }] },
    openai: { models: [{ modelId: 'cloud', maxContextWindow: 128000 }] },
  },
}

describe('session context window tier', () => {
  it('round-trips the tier and keeps old or invalid settings at Default', () => {
    expect(
      SessionSettingsSchema.parse(JSON.parse(JSON.stringify({ contextWindowTier: 'half' }))).contextWindowTier
    ).toBe('half')
    expect(SessionSettingsSchema.parse({}).contextWindowTier).toBeUndefined()
    expect(SessionSettingsSchema.parse({ contextWindowTier: 16384 }).contextWindowTier).toBeUndefined()
  })

  it('uses the saved tier only when the current Provider supports control; an explicit Default wins', () => {
    const settings = { provider: 'ollama', modelId: 'local', contextWindowTier: 'half' } as const
    expect(resolveSessionContextWindowOverride(settings, globalSettings)).toEqual({
      providerId: 'ollama',
      modelId: 'local',
      tokens: 16384,
    })
    expect(resolveSessionContextWindowOverride(settings, globalSettings, null)).toBeUndefined()
    const cloud = { ...settings, provider: 'openai', modelId: 'cloud' }
    expect(
      getContextWindowSelection({ providerId: 'openai', ...globalSettings.providers.openai.models[0] })
    ).toBeUndefined()
    expect(resolveSessionContextWindowOverride(cloud, globalSettings)).toBeUndefined()
  })
})
