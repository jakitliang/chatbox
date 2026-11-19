// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { openAIResponsesReasoning } from '@shared/providers/definitions/models/openai-reasoning'
import type { ProviderOptions } from '@shared/types'
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test-utils'
import ReasoningControlButton from './ReasoningControlButton'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(
    (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })
  ),
})

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, values?: { level?: string }) => (values?.level ? key.replace('{{level}}', values.level) : key),
  }),
}))

function model(modelId: string) {
  const policy = openAIResponsesReasoning(modelId)
  return { getReasoningOptions: policy.getOptions, readReasoningLevel: policy.readLevel }
}

function renderButton(reasoningEffort: 'low' | 'medium' | 'high' = 'high') {
  const providerOptions: ProviderOptions = { openai: { reasoningEffort } }
  return render(
    <MantineProvider>
      <ReasoningControlButton
        model={model('gpt-5.1')}
        providerOptions={providerOptions}
        iconSize={22}
        onChange={vi.fn()}
      />
    </MantineProvider>
  )
}

describe('ReasoningControlButton', () => {
  test('renders and selects a model-defined effort without translating its name', async () => {
    const onChange = vi.fn()
    render(
      <MantineProvider>
        <ReasoningControlButton
          model={{
            getReasoningOptions: () => [{ level: 'effort:balanced', label: 'effort:balanced' }],
            readReasoningLevel: () => 'effort:balanced',
          }}
          iconSize={22}
          onChange={onChange}
        />
      </MantineProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Thinking: balanced' }))
    const item = await screen.findByTestId(TestId.reasoning.level('effort:balanced'))
    expect(item.textContent).toBe('balanced')
    fireEvent.click(item)
    expect(onChange).toHaveBeenCalledWith('effort:balanced')
  })

  test('shows Astra thinking controls and lets the user choose high effort', async () => {
    const onChange = vi.fn()
    render(
      <MantineProvider>
        <ReasoningControlButton model={model('gpt-6-astra')} iconSize={22} onChange={onChange} />
      </MantineProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Thinking: Default' }))
    await waitFor(() => expect(screen.getByTestId(TestId.reasoning.level('high'))).toBeTruthy())
    fireEvent.click(screen.getByTestId(TestId.reasoning.level('high')))
    expect(onChange).toHaveBeenCalledWith('high')
    expect(screen.queryByTestId(TestId.reasoning.level('off'))).toBeNull()
  })

  test('shows a state icon instead of the level text', () => {
    const view = renderButton()

    expect(screen.getByRole('button', { name: 'Thinking: High' })).toBeTruthy()
    expect(view.container.querySelector('[data-reasoning-level="high"]')).toBeTruthy()
    expect(view.container.querySelector('button')?.textContent).toBe('')
  })

  test.each([
    ['low', 1],
    ['medium', 2],
    ['high', 3],
  ] as const)('shows %s effort with %i active dots', (level, activeDotCount) => {
    const view = renderButton(level)
    const status = view.container.querySelector(`[data-reasoning-status="${level}"]`)

    expect(status?.querySelectorAll('[data-reasoning-dot="active"]')).toHaveLength(activeDotCount)
    expect(status?.querySelectorAll('[data-reasoning-dot="inactive"]')).toHaveLength(3 - activeDotCount)
  })

  test('opens the effort menu with level labels when the trigger is clicked', async () => {
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Thinking: High' }))

    await waitFor(() => expect(screen.getByTestId(TestId.reasoning.menu)).toBeTruthy())
    expect(screen.getByTestId(TestId.reasoning.level('default'))).toBeTruthy()
    // The level text lives in the menu items now that the trigger is icon-only.
    expect(screen.getByTestId(TestId.reasoning.level('high')).textContent).toContain('High')
  })
})
