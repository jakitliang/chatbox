import { ModelProviderEnum } from '@shared/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { GenericProviderRows } from './GenericProviderRows'

vi.mock('./ModelRow', () => ({
  ModelRow: ({ detail }: { detail: { name: string } }) => <button>{detail.name}</button>,
}))
vi.mock('./ProviderRowHeader', () => ({
  ProviderRowHeader: ({ provider }: { provider: { name: string } }) => <header>{provider.name}</header>,
}))

const provider = { id: ModelProviderEnum.FastFlowLM, name: 'FastFlowLM' }
const model = { modelId: 'qwen3.5:4b', nickname: 'Local Qwen' }
const otherModel = { modelId: 'qwen3.5:9b' }
const noop = () => undefined

function renderRows(favoriteOnly: boolean, search = '', collapsed = false) {
  return renderToStaticMarkup(
    <GenericProviderRows
      favoriteOnly={favoriteOnly}
      genericProviders={[{ ...provider, models: [model, otherModel] }]}
      favoritedModels={[{ provider, model }]}
      collapsedProviders={{ [provider.id]: collapsed }}
      search={search}
      isMobile={false}
      isFavorited={() => true}
      onToggleProvider={noop}
      onSelect={noop}
      onToggleFavorite={noop}
      onShowMobileDetail={noop}
      onDesktopDetailOpen={noop}
      onDesktopDetailClose={noop}
      onDisabledSelect={noop}
    />
  )
}

describe('Generic provider model rows', () => {
  it.each([false, true])('shows provider and models without a divider, favoriteOnly=%s', (favoriteOnly) => {
    const html = renderRows(favoriteOnly)
    expect(html).toContain('FastFlowLM')
    expect(html).toContain('Local Qwen')
    expect(html).not.toContain('More Providers')
    expect(html).not.toContain('BYOK')
  })

  it('keeps favorite filtering and search available', () => {
    expect(renderRows(false)).toContain(otherModel.modelId)
    expect(renderRows(true, 'Local Qwen')).toContain('Local Qwen')
    expect(renderRows(true, 'Local Qwen')).not.toContain(otherModel.modelId)
    expect(renderRows(true, 'no match')).toBe('')
  })

  it('keeps provider headers when models are collapsed', () => {
    const html = renderRows(false, '', true)
    expect(html).toContain('FastFlowLM')
    expect(html).not.toContain('Local Qwen')
  })
})
