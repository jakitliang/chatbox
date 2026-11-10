import { MantineProvider } from '@mantine/core'
import type { ProviderModelInfo } from '../../shared/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ModelList } from './ModelList'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/ui/tooltip', () => ({
  AppTooltip: ({ children, label }: { children: React.ReactNode; label: string }) => <span title={label}>{children}</span>,
}))

function render(model: ProviderModelInfo) {
  return renderToStaticMarkup(
    <MantineProvider><ModelList models={[model]} showSearch={false} showActions={false} /></MantineProvider>
  )
}

describe('Ollama informational model display', () => {
  it('renders persisted metadata without fetching or exposing a fake output limit', () => {
    const model: ProviderModelInfo = {
      modelId: 'llama:local', type: 'chat',
      ollamaDisplayMetadata: { contextLength: 131072, configuredContextLength: 32768 },
    }
    const html = render(JSON.parse(JSON.stringify(model)))
    expect(html).toContain('131K')
    expect(html).toContain('Ollama model_info): 131072 tokens')
    expect(html).toContain('Ollama num_ctx: 32768')
    expect(html).not.toContain('Max Output')
  })

  it('retains the existing capacity display for other providers', () => {
    const html = render({ modelId: 'cloud', type: 'chat', contextWindow: 1000000, maxOutput: 65536 })
    expect(html).toContain('1.0M')
    expect(html).toContain('66K')
  })

  it('does not invent missing capacities', () => {
    expect(render({ modelId: 'local', type: 'chat', ollamaDisplayMetadata: {} })).not.toContain('Ollama model_info')
  })
})