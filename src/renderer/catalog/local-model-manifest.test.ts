import { describe, expect, it } from 'vitest'
import { listLocalModelManifestProviders, loadLocalModelManifest } from './local-model-manifest'

describe('bundled model manifests', () => {
  it('loads all 15 downloaded provider catalogs without network access', () => {
    const providers = listLocalModelManifestProviders()
    expect(providers).toHaveLength(15)
    for (const provider of providers) expect(loadLocalModelManifest(provider).models).toBeInstanceOf(Array)
    expect(loadLocalModelManifest('claude').models).toHaveLength(3)
    expect(loadLocalModelManifest('openai').imageModels).toHaveLength(3)
    expect(loadLocalModelManifest('gemini').imageModels).toHaveLength(2)
  })
  it('returns detached values and safely handles unknown provider identifiers', () => {
    const first = loadLocalModelManifest('claude')
    first.models.length = 0
    expect(loadLocalModelManifest('claude').models).toHaveLength(3)
    for (const provider of ['unknown', '__proto__', 'constructor']) {
      expect(loadLocalModelManifest(provider)).toEqual({ groupName: '', models: [], imageModels: [] })
    }
  })
})