import { cloneDeep } from 'lodash'
import { useCallback, useEffect, useState } from 'react'
import { mcpController } from '@/packages/mcp/controller'
import type { MCPServerConfig, MCPServerStatus } from '@/packages/mcp/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { trackEvent } from '@/utils/track'

export function useMCPServerStatus(id: string) {
  const [status, setStatus] = useState<MCPServerStatus | null>(null)
  useEffect(() => {
    return mcpController.subscribeToServerStatus(id, setStatus)
  }, [id])
  return status
}

export function useToggleMCPServer() {
  const setSettings = useSettingsStore((state) => state.setSettings)
  return useCallback(
    (id: string, enabled: boolean) => {
      let effect = null as { action: 'start'; config: MCPServerConfig } | { action: 'stop'; id: string } | null
      setSettings((draft) => {
        const server = draft.mcp.servers.find((s) => s.id === id)
        if (!server) return
        server.enabled = enabled
        effect = enabled ? { action: 'start', config: cloneDeep(server) } : { action: 'stop', id }
      })
      if (effect?.action === 'start') {
        mcpController.startServer(effect.config)
      } else if (effect?.action === 'stop') {
        mcpController.stopServer(effect.id)
      }
      trackEvent('toggle_mcp_server', {
        server_type: 'custom',
        enabled,
      })
    },
    [setSettings]
  )
}
