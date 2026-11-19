// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { getQuarterContextTarget } from '@shared/providers/context-window-control'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TokenCountMenu from './TokenCountMenu'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen: () => false,
}))

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

function renderMenu(props: Partial<React.ComponentProps<typeof TokenCountMenu>> = {}) {
  return render(
    <MantineProvider>
      <TokenCountMenu
        currentInputTokens={100}
        contextTokens={1000}
        totalTokens={1100}
        totalContextMessages={3}
        {...props}
      >
        <button type="button">Tokens</button>
      </TokenCountMenu>
    </MantineProvider>
  )
}

function getMenuRow(label: string): HTMLElement {
  const labelElement = screen.getByText(`${label}:`)
  const row = labelElement.parentElement
  if (!row) throw new Error(`Missing ${label} row`)
  return row
}

describe('TokenCountMenu', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('keeps cached context exact while only the draft is calculating', () => {
    renderMenu({
      isCalculating: true,
      isContextCalculating: false,
      pendingContextMessages: 0,
    })

    expect(getMenuRow('Context').textContent).toContain('Context:1K')
    expect(getMenuRow('Context').textContent).not.toContain('~')
    expect(getMenuRow('Context').textContent).not.toContain('(3/3)')
    expect(getMenuRow('Total').textContent).toContain('Total:~1K')
    expect(getMenuRow('Total').querySelector('.mantine-Loader-root')).not.toBeNull()
  })

  it('shows context progress from distinct pending context messages', () => {
    renderMenu({
      isCalculating: true,
      isContextCalculating: true,
      pendingContextMessages: 1,
    })

    expect(getMenuRow('Context').textContent).toContain('Context:~1K(2/3)')
  })

  it('labels a loaded-message estimate and hides complete-context counts and compression', () => {
    renderMenu({
      isCalculating: true,
      isContextCalculating: true,
      isContextLoading: true,
      pendingContextMessages: 1,
      currentMessageCount: 3,
      maxContextMessageCount: 100,
      onCompressClick: vi.fn(),
    })
    expect(screen.getByRole('status', { hidden: true }).textContent).toContain('Loading context...')
    expect(getMenuRow('Context').textContent).not.toContain('(2/3)')
    expect(screen.queryByText('Context messages:')).toBeNull()
    expect(screen.queryByText('Compress Conversation')).toBeNull()
  })

  it('keeps failed draft estimates marked approximate without showing a loader', () => {
    renderMenu({
      isCalculating: false,
      isCurrentInputApproximate: true,
      isTotalApproximate: true,
      isContextCalculating: false,
      pendingContextMessages: 0,
    })

    expect(getMenuRow('Current input').textContent).toContain('Current input:~100')
    expect(getMenuRow('Context').textContent).toContain('Context:1K')
    expect(getMenuRow('Context').textContent).not.toContain('~')
    expect(getMenuRow('Total').textContent).toContain('Total:~1K')
    expect(getMenuRow('Total').querySelector('.mantine-Loader-root')).toBeNull()
  })

  it('previews five discrete tiers without changing the maximum or loaded window', () => {
    renderMenu({
      contextWindow: 16_000,
      contextWindowControl: {
        scope: 'local',
        maxTokens: 128_000,
        getTarget: (tier) => getQuarterContextTarget(128_000, tier),
      },
    })

    const slider = screen.getByRole('slider', { hidden: true })
    const preview = slider.closest('.mantine-Slider-root')?.parentElement
    expect(preview?.previousElementSibling?.classList.contains('mantine-Menu-divider')).toBe(true)
    expect(screen.getByText('Requested context window: Default')).not.toBeNull()
    for (const [index, label] of ['32K', '64K', '96K', '128K'].entries()) {
      fireEvent.keyDown(slider, { key: 'ArrowRight' })
      expect(slider.getAttribute('aria-valuenow')).toBe(String(index + 1))
      expect(screen.getByText(`Requested context window: ${label}`)).not.toBeNull()
    }
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(slider.getAttribute('aria-valuenow')).toBe('4')
    expect(getMenuRow('Model limit').textContent).toBe('Model limit:128K')
    expect(getMenuRow('Loaded context window').textContent).toBe('Loaded context window:16K')
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(screen.getByText('Requested context window: Default')).not.toBeNull()
  })

  it('leaves the existing model limit alone without a preview', () => {
    renderMenu({ contextWindow: 16_000 })
    expect(screen.queryByRole('slider', { hidden: true })).toBeNull()
    expect(getMenuRow('Model limit').textContent).toBe('Model limit:16K')
  })
})
