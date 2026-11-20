import { describe, expect, it, vi } from 'vitest'
import { listLocalModelManifestProviders, loadLocalModelManifest } from './local-model-manifest'

vi.mock('../../../server/snapshot/browser-catalog.json', () => ({
  default: {
    models: [
      { provider: 'example', status: 200, data: { data: { groupName: 'Crawled' } } },
      { provider: 'empty', status: 200, data: { data: { groupName: 'Empty', models: null } } },
      { provider: 'failed', status: 503, data: null },
    ],
  },
}))

vi.mock('../../../server/snapshot/configs.json', () => ({
  default: {
    models: {
      example: { groupName: 'Configured', models: [{ modelId: 'local', modelName: 'Local' }] },
    },
  },
}))

describe('bundled model manifests', () => {
  it('combines successful snapshots and gives explicit provider configuration precedence', () => {
    expect(listLocalModelManifestProviders().sort()).toEqual(['empty', 'example'])
    expect(loadLocalModelManifest('empty')).toEqual({ groupName: 'Empty', models: [], imageModels: [] })
    expect(loadLocalModelManifest('example')).toEqual({
      groupName: 'Configured',
      models: [{ modelId: 'local', modelName: 'Local' }],
      imageModels: [],
    })
  })
  it('returns detached values and safely handles unknown provider identifiers', () => {
    const first = loadLocalModelManifest('example')
    first.models.length = 0
    expect(loadLocalModelManifest('example').models).toHaveLength(1)
    for (const provider of ['unknown', '__proto__', 'constructor']) {
      expect(loadLocalModelManifest(provider)).toEqual({ groupName: '', models: [], imageModels: [] })
    }
  })
})