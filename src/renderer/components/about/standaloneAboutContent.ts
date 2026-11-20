import { MAX_TOOL_CALLS_BEFORE_CONFIRMATION } from '@shared/utils/tool-call-limit-pause'
import type { TFunction } from 'i18next'

export const recentStandaloneCommits = [
  ['11a81caa', '2026-11-21', 'chore: remove unsupported content reporting from chat and image generation'],
  ['19e79630', '2026-11-21', 'refactor: unify document parsing and remove Chatbox AI cloud fallback'],
  ['2786e718', '2026-11-21', 'refactor: unify cross-platform mcp tool selection and remove subscription-only servers'],
  ['5b4fe9bb', '2026-11-21', 'feat: unify web search providers and add a same-origin relay for web'],
  ['9f50d8c5', '2026-11-21', 'chore: remove legacy Chatbox AI entries from model selection and web search'],
  ['e4efd935', '2026-11-20', 'feat: add per-session context window controls for Ollama and FastFlowLM'],
  ['2fb16fca', '2026-11-20', 'chore: clean up fixed data'],
  ['78f4bef8', '2026-11-20', 'refactor: move reasoning controls and replay into model adapters'],
  ['6a6f8a6f', '2026-11-20', 'feat: model config add reasoning'],
  ['36c7dc7c', '2026-11-20', 'feat: update support for FLM'],
  ['30cef2c3', '2026-11-20', 'refact: clean ollama wrong code'],
  ['7fbe321e', '2026-11-18', 'refactor: unify context capacity resolution with provider delegates'],
] as const

type QuickReferenceRow = readonly [item: string, location: string, scope: string, defaultValue: string, notes: string]

type QuickReference = {
  title: string
  headers: QuickReferenceRow
  rows: readonly QuickReferenceRow[]
}

export function getConfigurationQuickReference(t: TFunction): QuickReference {
  const settings = t('Settings')
  const panel = t('Panel')
  const global = t('Global')
  const perChat = t('Per chat')
  const extensions = `${panel} · ${t('Extensions')}`
  const builtIn = `${panel} · ${t('Built-in')}`
  const modelProvider = t('Model Provider')
  const webSearch = t('Web Search')
  const parser = t('Document Parser')
  return {
    title: t('Configuration Quick Reference'),
    headers: [t('Setting'), t('Location'), t('Storage scope'), t('Default'), t('Key details')],
    rows: [
      [
        modelProvider,
        `${settings} → ${modelProvider} / ${t('Default Models')}`,
        global,
        t('Configure manually'),
        t('Connect to FastFlowLM or Ollama, or use your own API key.'),
      ],
      [t('Mode'), t('Top of panel'), perChat, t('Chat Mode'), t('Locks after the first message.')],
      [
        t('Smart Switching'),
        `${panel} · ${t('Mode')}`,
        t('Global default'),
        t('On'),
        t('Chat mode only; applies before the first message.'),
      ],
      [
        webSearch,
        `${builtIn} / ${settings} → ${webSearch}`,
        t('Per-chat toggle; global provider'),
        t('Off'),
        t('Requires tool calling; page reading depends on the search provider.'),
      ],
      [t('Command approval'), builtIn, perChat, t('Smart Approval'), t('Full access skips command approvals.')],
      [
        t('Skills'),
        `${extensions} / ${settings}`,
        global,
        t('Built-in skills'),
        t('Compatible with Claude Code skills.'),
      ],
      [
        t('MCP'),
        `${extensions} / ${settings} → ${t('MCP')}`,
        global,
        t('No servers configured'),
        t('Add a server and enable it; tools require an active connection.'),
      ],
      [
        parser,
        `${settings} → ${parser}`,
        t('Global; overridable per knowledge base'),
        t('Built-in parser'),
        t('No automatic upload on failure. Desktop users can select MinerU and enter an API token.'),
      ],
      [t('Knowledge Base'), extensions, perChat, t('Not linked'), t('One per chat; unavailable on Windows ARM64.')],
      [t('Working Directory'), extensions, perChat, t('None'), t('Desktop only; no approvals within the directory.')],
      [
        t('Pause after every {{count}} steps', { count: MAX_TOOL_CALLS_BEFORE_CONFIRMATION }),
        `${settings} → ${t('Chat')}`,
        t('Global default, overridable per chat'),
        t('On'),
        t('Pauses after {{count}} tool calls; full access bypasses the pause.', {
          count: MAX_TOOL_CALLS_BEFORE_CONFIRMATION,
        }),
      ],
    ],
  }
}
