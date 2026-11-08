import { createFileRoute } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { z } from 'zod'
import LocalCopilotList from './-components/LocalCopilotList'

const searchSchema = z.object({
  q: z.string().optional(),
})

export const Route = createFileRoute('/copilots/search' as never)({
  component: CopilotSearch,
  validateSearch: zodValidator(searchSchema),
})

function CopilotSearch() {
  const searchParams = Route.useSearch() as { q?: string }
  return <LocalCopilotList search={(searchParams.q ?? '').trim()} />
}

export default CopilotSearch
