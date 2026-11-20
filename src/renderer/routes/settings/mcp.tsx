import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import CustomServersSection from '@/components/settings/mcp/CustomServersSection'
import { parseServerFromJson } from '@/components/settings/mcp/utils'
import { SettingsPage } from '@/components/settings/SettingsLayout'
import { mcpController } from '@/packages/mcp/controller'
import type { MCPServerConfig } from '@/packages/mcp/types'
import platform from '@/platform'
import { settingsStore } from '@/stores/settingsStore'
import { decodeBase64 } from '@/utils/base64'

const searchSchema = z.object({
  install: z.string().optional(), // b64 encoded config
})

export const Route = createFileRoute('/settings/mcp')({
  component: RouteComponent,
  validateSearch: zodValidator(searchSchema),
})

export function RouteComponent() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const [installConfig, setInstallConfig] = useState<MCPServerConfig | undefined>(undefined)

  useEffect(() => {
    if (platform.type !== 'mobile') return
    const controller = new AbortController()
    void mcpController.connectEnabledServers(settingsStore.getState().mcp.servers, controller.signal).catch((error) => {
      if (!controller.signal.aborted) console.error('MCP settings connection failed:', error)
    })
    return () => controller.abort()
  }, [])

  // Handle install parameter from search params
  useEffect(() => {
    if (searchParams.install) {
      try {
        const config = parseServerFromJson(decodeBase64(searchParams.install))
        setInstallConfig(config)
      } catch (err) {
        console.error(err)
      }
      // Clear search params immediately after reading
      navigate({
        to: '/settings/mcp',
        search: {},
        replace: true,
      })
    }
  }, [searchParams.install, navigate])

  return (
    <SettingsPage
      title={t('MCP Settings')}
      description={
        platform.type === 'mobile'
          ? t('On mobile, connect remote HTTP servers using a URL and headers. OAuth sign-in is not available.')
          : t('Tools from MCP servers are available to models that support tool use.')
      }
    >
      <CustomServersSection installConfig={installConfig} />
    </SettingsPage>
  )
}
