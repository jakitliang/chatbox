import { MantineProvider } from '@mantine/core'
import type { ProviderModelInfo } from '../../shared/types'
import { setRuntimeRegistry } from '@shared/model-registry/enrich'
import type { ModelMetadata } from '@shared/model-registry/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ModelList } from './ModelList'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/ui/tooltip', () => ({
  AppTooltip: ({ children, label }: { children: React.ReactNode; label: string }) => (
    <span title={label}>{children}</span>
  ),
}))

function render(model: ProviderModelInfo, providerId?: string) {
  return renderToStaticMarkup(
    <MantineProvider>
      <ModelList providerId={providerId} models={[model]} showSearch={false} showActions={false} />
    </MantineProvider>
  )
}

describe('ModelList context window display', () => {
  it('resolves a catalog-only maximum using the enclosing provider identity', () => {
    setRuntimeRegistry({
      'model-list-fixture': {
        'catalog-only': {
          modelId: 'catalog-only',
          name: 'Catalog only',
          type: 'chat',
          capabilities: [],
          contextWindow: 65536,
          maxOutput: 0,
        } satisfies ModelMetadata,
      },
    })
    try {
      expect(render({ modelId: 'catalog-only', type: 'chat' }, 'model-list-fixture')).toContain('66K')
    } finally {
      setRuntimeRegistry(null)
    }
  })

  it('displays the explicit maximum rather than the smaller budget window', () => {
    expect(render({ modelId: 'private', type: 'chat', contextWindow: 8192, maxContextWindow: 65536 })).toContain('66K')
  })
  it('uses the same context window tooltip for Ollama models', () => {
    const model: ProviderModelInfo = {
      modelId: 'llama:local',
      type: 'chat',
      maxContextWindow: 131072,
    }
    const html = render(model, 'ollama')
    expect(html).toContain('title="Context Window: 131K tokens"')
    expect(html).not.toContain('Ollama')
    expect(html).not.toContain('Max Output')
  })

  it('retains the existing capacity display for other providers', () => {
    const html = render({ modelId: 'cloud', type: 'chat', contextWindow: 1000000, maxOutput: 65536 })
    expect(html).toContain('1.0M')
    expect(html).toContain('66K')
  })
})
