import { Navigate } from '@tanstack/react-router'

// Compatibility for the development story; no commercial settings implementation.
export function ChatboxAISettings(_props: { padded?: boolean }) {
  return <Navigate to="/settings/provider" />
}
