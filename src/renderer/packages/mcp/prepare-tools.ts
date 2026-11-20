import { prepareMCPTools } from '@chatbox/core/mcp'
import { mcpController } from './controller'

export function prepareSessionMCPTools(options: Omit<Parameters<typeof prepareMCPTools>[0], 'controller'>) {
  return prepareMCPTools({ ...options, controller: mcpController })
}
