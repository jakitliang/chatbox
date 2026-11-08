import React from 'react'

export interface LocalErrorBoundaryProps {
  children: React.ReactNode
  fallback: (props: { error: Error; resetError: () => void }) => React.ReactNode
  onError?: (error: Error, componentStack: string | null | undefined) => void
}

/** React recovery only. Error state stays in this mounted component, never in an SDK. */
export class LocalErrorBoundary extends React.Component<LocalErrorBoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.props.onError?.(error, info.componentStack)
  }

  private resetError = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    return this.state.error
      ? this.props.fallback({ error: this.state.error, resetError: this.resetError })
      : this.props.children
  }
}

/** Compatibility facade without an SDK, a transport, event buffering, or identifiers. */
export class LocalScope {
  setTag(_key: string, _value: string | number | boolean): void {}
  setExtra(_key: string, _value: unknown): void {}
  setLevel(_level: string): void {}
  setContext(_key: string, _value: unknown): void {}
}
export function captureException(_error: unknown): void {}
export function captureMessage(_message: string, _level?: string): void {}
export function withScope(callback: (scope: LocalScope) => void): void {
  callback(new LocalScope())
}

interface BoundaryProps {
  children?: React.ReactNode
  fallback: (props: { error: Error; resetError: () => void }) => React.ReactNode
  beforeCapture?: (scope: LocalScope, error: Error, componentStack: string) => void
  showDialog?: boolean
}

/** Keeps the existing local error UI and recovery behavior, with no remote error reporting. */
export class ErrorBoundary extends React.Component<BoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.props.beforeCapture?.(new LocalScope(), error, info.componentStack ?? '')
  }
  render() {
    return this.state.error
      ? this.props.fallback({ error: this.state.error, resetError: () => this.setState({ error: null }) })
      : this.props.children
  }
}

export function withErrorBoundary<P extends object>(Component: React.ComponentType<P>, options: Omit<BoundaryProps, 'children'>) {
  return function LocalErrorBoundary(props: P) {
    return <ErrorBoundary {...options}><Component {...props} /></ErrorBoundary>
  }
}