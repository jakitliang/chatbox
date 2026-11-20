import { ActionIcon, Button, Flex, Group, Menu, Switch } from '@mantine/core'
import { IconSettings2 } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { type FC, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMCPServerStatus, useToggleMCPServer } from '@/hooks/mcp'
import { navigateToSettings } from '@/modals/settings-navigation'
import { mcpController } from '@/packages/mcp/controller'
import { useMcpSettings } from '@/stores/settingsStore'
import { ScalableIcon } from '../common/ScalableIcon'
import MCPStatus from './MCPStatus'

interface ServerItem {
  id: string
  name: string
  enabled: boolean
}

const ServerItem: FC<{
  item: ServerItem
  unsupported: boolean
  onEnabledChange: (id: string, enabled: boolean) => void
}> = ({ item, unsupported, onEnabledChange }) => {
  const status = useMCPServerStatus(item.id)
  return (
    <Menu.Item
      c="chatbox-primary"
      leftSection={<MCPStatus status={status} />}
      rightSection={
        <Switch
          checked={item.enabled}
          size="xs"
          disabled={unsupported || status?.state === 'starting' || status?.state === 'stopping'}
          onChange={(e) => onEnabledChange(item.id, e.currentTarget.checked)}
        />
      }
    >
      {item.name}
    </Menu.Item>
  )
}

const MCPMenu: FC<{ children: (enabledTools: number) => ReactNode }> = ({ children }) => {
  const { t } = useTranslation()
  const mcp = useMcpSettings()
  const onEnabledChange = useToggleMCPServer()
  const enabledToolsCount = mcpController.getEnabledServers(mcp.servers).length
  const [opened, setOpened] = useState(false)
  return (
    <Menu
      trigger="hover"
      openDelay={100}
      closeDelay={100}
      opened={opened}
      onChange={setOpened}
      shadow="md"
      withArrow
      width={240}
      closeOnItemClick={false}
      position="top-start"
      transitionProps={{
        transition: 'pop',
        duration: 200,
      }}
    >
      <Menu.Target>{children(enabledToolsCount)}</Menu.Target>
      <Menu.Dropdown>
        <Flex justify="space-between" align="center">
          <Menu.Label fw={600}>MCP</Menu.Label>
          <Menu.Label>
            <ActionIcon
              variant="subtle"
              size={20}
              onClick={() => {
                setOpened(false)
                navigateToSettings('/mcp')
              }}
            >
              <ScalableIcon icon={IconSettings2} size={16} color="var(--chatbox-tint-tertiary)" />
            </ActionIcon>
          </Menu.Label>
        </Flex>
        {mcp.servers.map((server) => (
          <ServerItem
            key={server.id}
            item={server}
            unsupported={Boolean(mcpController.getTransportIssue(server.transport.type))}
            onEnabledChange={onEnabledChange}
          />
        ))}
        {!mcp.servers.length && (
          <Group justify="center">
            <Link to="/settings/mcp">
              <Button size="xs" my={12} variant="outline">
                {t('Add your first MCP server')}
              </Button>
            </Link>
          </Group>
        )}
      </Menu.Dropdown>
    </Menu>
  )
}

export default MCPMenu
