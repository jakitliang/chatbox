import type { MCPServerConfig } from './types'

export interface BuildinMCPServerConfig {
  id: string
  name: string
  description: string
  url: string
}

// Self-hosted deployments configure their own MCP servers; no vendor services
// are seeded. Keep the registry and lookup exports for existing consumers.
export const BUILTIN_MCP_SERVERS: BuildinMCPServerConfig[] = []

export function getBuiltinServerConfig(id: string, _licenseKey?: string): MCPServerConfig | null {
  const config = BUILTIN_MCP_SERVERS.find((s) => s.id === id)
  if (!config) {
    return null
  }
  return {
    id,
    name: config.name,
    enabled: true,
    protocolMode: 'legacy',
    transport: {
      type: 'http',
      url: config.url,
    },
  }
}
