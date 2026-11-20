import { createMCPController, type MCPServerConfig } from '@chatbox/core/mcp'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { type MCPServer, mcpController } from './controller'
import { prepareSessionMCPTools } from './prepare-tools'

vi.mock('./controller', async () => {
  const { createMCPController } = await import('@chatbox/core/mcp')
  return { mcpController: createMCPController({ mobile: true }) }
})
const servers: MCPServerConfig[] = [
  { id: 'remote', name: 'Remote', enabled: true, transport: { type: 'http', url: 'https://example.com' } },
  { id: 'disabled', name: 'Disabled', enabled: false, transport: { type: 'http', url: 'https://example.com' } },
  { id: 'local', name: 'Local', enabled: true, transport: { type: 'stdio', command: 'npx', args: [] } },
]

vi.spyOn(mcpController, 'startServer')
vi.spyOn(mcpController, 'getServer')
vi.spyOn(mcpController, 'getAvailableTools')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(mcpController.getServer).mockReset()
  vi.mocked(mcpController.startServer).mockResolvedValue()
  vi.mocked(mcpController.getAvailableTools).mockReturnValue({})
})

describe('mobile MCP tool preparation', () => {
  test.each([
    [false, true],
    [true, false],
  ])('requires Work Mode=%s and model tool support=%s', async (enabled, supported) => {
    const result = await prepareSessionMCPTools({
      enabled,
      model: { isSupportToolUse: () => supported },
      servers,
      connect: true,
      signal: new AbortController().signal,
    })
    expect(result.tools).toEqual({})
    expect(mcpController.startServer).not.toHaveBeenCalled()
  })
  test('prepares enabled HTTP services and reports unavailable ones', async () => {
    const result = await prepareSessionMCPTools({
      enabled: true,
      model: { isSupportToolUse: () => true },
      servers,
      connect: true,
      signal: new AbortController().signal,
    })
    expect(mcpController.startServer).toHaveBeenCalledTimes(1)
    expect(mcpController.startServer).toHaveBeenCalledWith(servers[0], expect.objectContaining({ interactive: false }))
    expect(result.unavailable).toEqual(['Remote', 'Local'])
    expect(mcpController.getAvailableTools).toHaveBeenCalledWith(new Set())
  })
  test('does not connect after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      prepareSessionMCPTools({
        enabled: true,
        model: { isSupportToolUse: () => true },
        servers,
        connect: true,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mcpController.startServer).not.toHaveBeenCalled()
  })

  test('returns only connected tools from the enabled configuration snapshot', async () => {
    vi.mocked(mcpController.getServer).mockReturnValue({ status: { state: 'running' } } as MCPServer)
    const tools = { mcp__remote__echo: { description: 'echo', inputSchema: z.object({}) } }
    vi.mocked(mcpController.getAvailableTools).mockReturnValue(tools)
    const result = await prepareSessionMCPTools({
      enabled: true,
      model: { isSupportToolUse: () => true },
      servers,
      connect: true,
      signal: new AbortController().signal,
    })
    expect(result.tools).toBe(tools)
    expect(result.unavailable).toEqual(['Local'])
    expect(mcpController.getAvailableTools).toHaveBeenCalledWith(new Set(['remote']))
  })

  test('desktop uses only enabled, supported, connected servers without starting a connection', async () => {
    const { prepareMCPTools } = await import('@chatbox/core/mcp')
    const controller = createMCPController({ mobile: false, createStdioTransport: vi.fn() })
    vi.spyOn(controller, 'getServer').mockReturnValue({ status: { state: 'running' } } as MCPServer)
    const collect = vi.spyOn(controller, 'getAvailableTools').mockReturnValue({})
    const connect = vi.spyOn(controller, 'startServer')
    await prepareMCPTools({ controller, enabled: true, model: { isSupportToolUse: () => true }, servers })
    expect(connect).not.toHaveBeenCalled()
    expect(collect).toHaveBeenCalledWith(new Set(['remote', 'local']))
  })
})
