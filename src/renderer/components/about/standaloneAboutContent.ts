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

const quickReferenceZh: QuickReference = {
  title: '配置速查',
  headers: ['配置项', '位置', '存储级别', '默认', '关键点'],
  rows: [
    [
      '模型服务商',
      '设置 → 模型服务商 / 默认模型',
      '全局',
      '自行配置',
      '可连接本地模型服务（如 FastFlowLM、Ollama），或使用自己的 API 密钥',
    ],
    ['模式', '面板顶部', '会话级', '对话模式', '发出第一条消息后锁定'],
    ['智能切换', '面板 · 模式', '全局默认', '开启', '仅对话模式；首条消息前生效'],
    [
      '联网搜索',
      '面板 · 内置 / 设置 → 联网搜索',
      '会话开关；全局服务商',
      '关闭',
      '需模型支持工具调用；能否读取网页取决于所选搜索服务商',
    ],
    ['命令审批', '面板 · 内置', '会话级', '智能批准', '完全访问会跳过命令审批'],
    ['技能', '面板 · 扩展 / 设置', '全局', '内置若干', '兼容 Claude Code 技能'],
    ['MCP', '面板 · 扩展 / 设置 → MCP', '全局', '未配置服务器', '自行添加服务器；工具仅在服务器启用并连接后可用'],
    [
      '文档解析器',
      '设置 → 文档解析器',
      '全局；知识库可单独设置',
      '本地',
      '解析失败不自动上传；桌面端可手动选择 MinerU 并填写 API Token',
    ],
    ['知识库', '面板 · 扩展', '会话级', '未绑定', '一会话一库；Win ARM64 不支持'],
    ['工作目录', '面板 · 扩展', '会话级', '空', '桌面端；目录内免审批'],
    ['工具调用暂停', '设置 → 聊天', '全局默认，可按对话覆盖', '开启', '工具调用达到 25 次时暂停；完全访问模式不暂停'],
  ],
}

const quickReferenceEn: QuickReference = {
  title: 'Configuration Quick Reference',
  headers: ['Setting', 'Location', 'Storage scope', 'Default', 'Key details'],
  rows: [
    [
      'Model provider',
      'Settings → Model Provider / Default Models',
      'Global',
      'Configure manually',
      'Connect to a local model server such as FastFlowLM or Ollama, or use your own API key',
    ],
    ['Mode', 'Top of panel', 'Per chat', 'Chat mode', 'Locks after you send the first message'],
    ['Smart switching', 'Panel · Mode', 'Global default', 'On', 'Chat mode only; applies before the first message'],
    [
      'Web search',
      'Panel · Built-in / Settings → Web Search',
      'Per-chat toggle; global provider',
      'Off',
      'Requires a model with tool calling; page reading depends on the search provider',
    ],
    ['Command approval', 'Panel · Built-in', 'Per chat', 'Smart approval', 'Full access skips command approvals'],
    ['Skills', 'Panel · Extensions / Settings', 'Global', 'Built-in skills', 'Compatible with Claude Code skills'],
    [
      'MCP',
      'Panel · Extensions / Settings → MCP',
      'Global',
      'No servers configured',
      'Add your own servers; tools are available only while the server is enabled and connected',
    ],
    [
      'Document parser',
      'Settings → Document Parser',
      'Global; overridable per knowledge base',
      'Local',
      'No automatic upload on failure; desktop users can select MinerU and enter an API token',
    ],
    ['Knowledge base', 'Panel · Extensions', 'Per chat', 'Not linked', 'One per chat; unavailable on Windows ARM64'],
    ['Working directory', 'Panel · Extensions', 'Per chat', 'None', 'Desktop only; no approvals within the directory'],
    [
      'Pause on tool call limit',
      'Settings → Chat',
      'Global default, overridable per chat',
      'On',
      'Pauses after 25 tool calls; full access bypasses the pause',
    ],
  ],
}

export function getConfigurationQuickReference(language: string) {
  return /^zh(?:-|$)/i.test(language) ? quickReferenceZh : quickReferenceEn
}
