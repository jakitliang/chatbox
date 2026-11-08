import { describe, expect, it } from 'vitest'
import { createDefaultSettings, getDefaultDocumentParser } from './settings-defaults'
import { DocumentParserConfigSchema, ProviderSettingsSchema, SessionSettingsSchema, SettingsSchema } from './settings-schema'

describe('self-host settings', () => {
  it('defaults to local services with search, telemetry and updates opt-in', () => {
    const settings = createDefaultSettings()
    expect(settings.appApiServer).toBe('http://127.0.0.1:4567')
    expect(settings.webBrowsing).toBe(false)
    expect(settings.allowReportingAndTracking).toBe(false)
    expect(settings.autoUpdate).toBe(false)
    expect(settings.extension.webSearch.provider).toBe('bing')
    expect(getDefaultDocumentParser({ isDesktopLike: false })).toEqual({ type: 'local' })
    expect(getDefaultDocumentParser({ isDesktopLike: true })).toEqual({ type: 'local' })
  })

  it('normalizes legacy cloud services and drops paid global model defaults', () => {
    const old = createDefaultSettings()
    const parsed = SettingsSchema.parse({
      ...old,
      appApiServer: undefined,
      defaultChatModel: { provider: 'chatbox-ai', model: 'chatboxai-4' },
      defaultEmbeddingModel: { provider: 'chatbox-ai', model: 'text-embedding-3-small' },
      defaultRerankModel: { provider: 'ollama', model: 'local-reranker' },
      extension: { ...old.extension, webSearch: { provider: 'build-in' } },
    })
    expect(parsed.appApiServer).toBe('http://127.0.0.1:4567')
    expect(parsed.defaultChatModel).toBeUndefined()
    expect(parsed.defaultEmbeddingModel).toBeUndefined()
    expect(parsed.defaultRerankModel).toEqual({ provider: 'ollama', model: 'local-reranker' })
    expect(parsed.extension.webSearch.provider).toBe('bing')
    expect(DocumentParserConfigSchema.parse({ type: 'chatbox-ai' }).type).toBe('local')
  })

  it('still parses historical chats without changing their recorded provider', () => {
    expect(SessionSettingsSchema.parse({ provider: 'chatbox-ai', modelId: 'chatboxai-4' }).provider).toBe('chatbox-ai')
  })
})

describe('provider model groups', () => {
  it('accepts saved settings without groups and retains groups when present', () => {
    const provider = { models: [{ modelId: 'model' }], excludedModels: ['hidden'] }
    expect(ProviderSettingsSchema.parse(provider)).toEqual(provider)

    const grouped = { ...provider, modelGroups: [{ id: 'basic', modelIds: ['model'] }] }
    expect(ProviderSettingsSchema.parse(JSON.parse(JSON.stringify(grouped)))).toEqual(grouped)
  })

  it('drops malformed groups without discarding the configured models', () => {
    const parsed = ProviderSettingsSchema.parse({
      models: [{ modelId: 'model' }],
      modelGroups: [{ id: 'basic', modelIds: null }],
      excludedModels: ['hidden'],
    })

    expect(parsed).toEqual({ models: [{ modelId: 'model' }], modelGroups: undefined, excludedModels: ['hidden'] })
  })
})
