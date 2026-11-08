import React from 'react'
import { LocalErrorBoundary } from '../../observability/local-diagnostics'
import { getLogger } from '../../lib/utils'
import { router } from '../../router'

const log = getLogger('ErrorBoundary')

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ComponentType<{ error: Error; retry: () => void }>
  name?: string
  onError?: (error: Error) => void
}

/** Local error logging and retry recovery, without remote reporting. */
export function ErrorBoundary({
  children,
  fallback: CustomFallback,
  name = 'ErrorBoundary',
  onError,
}: ErrorBoundaryProps) {
  return (
    <LocalErrorBoundary
      fallback={(fallbackProps) => {
        const { error, resetError } = fallbackProps
        const errorObj = error instanceof Error ? error : new Error(String(error))

        // Use custom fallback if provided, otherwise use default
        if (CustomFallback) {
          return <CustomFallback error={errorObj} retry={resetError} />
        }

        return <DefaultErrorFallback error={errorObj} retry={resetError} />
      }}
      onError={(error, componentStack) => {
        log.error(`${name} caught an error:`, error, componentStack)
        onError?.(error)
      }}
    >
      {children}
    </LocalErrorBoundary>
  )
}

interface DefaultErrorFallbackProps {
  error: Error | null
  retry: () => void
}

function DefaultErrorFallback({ error, retry }: DefaultErrorFallbackProps) {
  const [showDetails, setShowDetails] = React.useState(false)

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center">
        <div className="text-red-500 text-6xl mb-4">⚠️</div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Something went wrong!</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          The application encountered an unexpected error. Details are kept in local logs and are not uploaded.
        </p>

        <div className="space-y-3">
          <button
            onClick={retry}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition-colors"
          >
            Try Again
          </button>

          <button
            onClick={() => {
              retry()
              router.navigate({ to: '/', replace: true })
            }}
            className="w-full bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors"
          >
            Reload App
          </button>

          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-4 py-2 rounded-lg transition-colors text-sm"
          >
            {showDetails ? 'Hide Error' : 'Show Error'}
          </button>
        </div>

        {showDetails && (
          <div className="mt-4 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg text-left">
            <div className="text-sm text-gray-700 dark:text-gray-300 space-y-2">
              {error && (
                <div>
                  <strong>Error:</strong>
                  <pre className="mt-1 text-xs overflow-auto whitespace-pre-wrap">
                    {error.name}: {error.message}
                  </pre>
                </div>
              )}
              {error?.stack && (
                <div>
                  <strong>Stack:</strong>
                  <pre className="mt-1 text-xs overflow-auto whitespace-pre-wrap max-h-32">{error.stack}</pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Legacy export name retained; uses the same local-only recovery boundary.
export const SentryErrorBoundary = ErrorBoundary
