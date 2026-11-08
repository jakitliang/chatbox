import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/provider/chatbox-ai/')({
  beforeLoad: () => { throw redirect({ to: '/settings/provider' }) },
})
