// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fixtures = vi.hoisted(() => Array.from({ length: 30 }, (_, index) => ({
  id: String(index), name: `Assistant ${index}`, prompt: 'Help', category: index < 20 ? 'Work' : 'Study', starred: index < 15,
})))
vi.mock('@/hooks/useCopilots', () => ({ useMyCopilots: () => ({ copilots: fixtures, isLoading: false, error: null, addOrUpdate: vi.fn() }) }))
vi.mock('@/stores/uiStore', () => ({ useUIStore: (selector: (value: unknown) => unknown) => selector({ showCopilotsInNewSession: false, setShowCopilotsInNewSession: vi.fn() }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
vi.mock('./CopilotItem', () => ({ default: ({ copilot }: { copilot: { name: string } }) => <div data-testid="copilot-card">{copilot.name}</div> }))
import LocalCopilotList from './LocalCopilotList'
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('paginates all, pinned and category results and resets on filter changes', () => {
  render(<MantineProvider><LocalCopilotList /></MantineProvider>)
  expect(screen.getByRole('button', { name: 'Pinned' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByText('All'))
  expect(screen.getAllByTestId('copilot-card')).toHaveLength(12)
  fireEvent.click(screen.getByText('Load More'))
  expect(screen.getAllByTestId('copilot-card')).toHaveLength(24)
  fireEvent.click(screen.getByText('Pinned'))
  expect(screen.getAllByTestId('copilot-card')).toHaveLength(12)
  fireEvent.click(screen.getByText('Load More'))
  expect(screen.getAllByTestId('copilot-card')).toHaveLength(15)
  expect(screen.queryByText('Load More')).toBeNull()
  fireEvent.click(screen.getByText('Work'))
  expect(screen.getAllByTestId('copilot-card')).toHaveLength(12)
  fireEvent.click(screen.getByText('Load More'))
  expect(screen.getAllByTestId('copilot-card')).toHaveLength(20)
  fireEvent.click(screen.getByText('All'))
  expect(screen.getAllByTestId('copilot-card')).toHaveLength(12)
})
it('resets the page when search changes', () => {
  const view = render(<MantineProvider><LocalCopilotList /></MantineProvider>)
  fireEvent.click(screen.getByText('Load More'))
  view.rerender(<MantineProvider><LocalCopilotList search="Assistant" /></MantineProvider>)
  expect(screen.getAllByTestId('copilot-card')).toHaveLength(12)
})
it('shows a centered illustration for empty search and category results', () => {
  const view = render(<MantineProvider><LocalCopilotList search="no-match-at-all" /></MantineProvider>)
  expect(screen.getByRole('status').querySelector('svg')).not.toBeNull()
  expect(screen.queryAllByTestId('copilot-card')).toHaveLength(0)
  expect(screen.queryByText('Load More')).toBeNull()
  view.rerender(<MantineProvider><LocalCopilotList /></MantineProvider>)
  fireEvent.click(screen.getByText('Uncategorized'))
  expect(screen.getByRole('status').querySelector('svg')).not.toBeNull()
})