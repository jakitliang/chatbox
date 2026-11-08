import { createFileRoute } from '@tanstack/react-router'
import LocalCopilotList from './-components/LocalCopilotList'

export const Route = createFileRoute('/copilots/my')({
  component: LocalCopilotList,
})
