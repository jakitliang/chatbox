import type { ToolSet } from 'ai'
import type { MCPController } from './controller'
import type { MCPServerConfig } from './types'

export async function prepareMCPTools({
  controller,
  enabled,
  model,
  servers,
  connect = false,
  signal,
}: {
  controller: MCPController
  enabled: boolean
  model: { isSupportToolUse(mode: 'agent'): boolean }
  servers: readonly MCPServerConfig[]
  connect?: boolean
  signal?: AbortSignal
}): Promise<{ tools: ToolSet; unavailable: string[] }> {
  if (!enabled || !model.isSupportToolUse('agent')) return { tools: {}, unavailable: [] }
  signal?.throwIfAborted()
  if (connect) await controller.connectEnabledServers(servers, signal)
  signal?.throwIfAborted()
  const ready = new Set(
    controller
      .getEnabledServers(servers)
      .filter((config) => controller.getServer(config.id)?.status.state === 'running')
      .map((config) => config.id)
  )
  return {
    tools: controller.getAvailableTools(ready),
    unavailable: servers.filter((config) => config.enabled && !ready.has(config.id)).map((config) => config.name),
  }
}
