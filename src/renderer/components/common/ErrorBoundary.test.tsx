// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary, SentryErrorBoundary } from './ErrorBoundary'

const { logError, navigate } = vi.hoisted(() => ({ logError: vi.fn(), navigate: vi.fn() }))
vi.mock('../../lib/utils', () => ({ getLogger: () => ({ error: logError }) }))
vi.mock('../../router', () => ({ router: { navigate } }))

afterEach(() => vi.restoreAllMocks())

describe('local error boundary', () => {
  it('logs locally, calls onError, and retries the child without reporting', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let fail = true
    function Child() {
      if (fail) throw new Error('local test failure')
      return <div>Recovered</div>
    }
    const onError = vi.fn()
    render(<ErrorBoundary onError={onError}><Child /></ErrorBoundary>)
    expect(screen.getByText(/not uploaded/)).toBeTruthy()
    expect(logError).toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(screen.getByText('Recovered')).toBeTruthy()
  })

  it('keeps the legacy boundary export local-only', () => {
    expect(SentryErrorBoundary).toBe(ErrorBoundary)
  })
})