# 工具与集成系统

> Last updated: 2026-08

本文档描述 Chatbox Pro 的工具（Tool）与外部集成系统的产品设计。关于整体架构和进程模型，请参阅 `./architecture.md`。

---

## 系统概览

Chatbox Pro 的工具系统为 AI 模型提供外部能力调用，使模型不仅能生成文本，还能执行搜索、读取文件、查询知识库、调用第三方服务等操作。当前工具系统由三个独立层次组成：

| 层次 | 位置 | 职责 |
|------|------|------|
| MCP 服务器 | Main 进程 + Renderer 控制器 | 管理外部 MCP 服务器连接，提供第三方工具 |
| 内置工具集（Toolsets） | `src/renderer/packages/model-calls/toolsets/` | 文件读取、知识库查询、网页搜索等内置工具 |
| Web Search 引擎 | `src/renderer/packages/web-search/` | 多搜索供应商的抽象层与执行器 |

这三层最终在 AI 调用时被统一合并为 Vercel AI SDK 的 `ToolSet`，传递给模型执行。

另有一类与工具构建紧耦合的能力是 **Agent Skills**：它不是传统的业务 API 工具，而是通过元数据注入 + 按需加载工具扩展模型行为。详细设计见 [`./agent-skills.md`](./agent-skills.md)。

## MCP 集成

### 设计动机

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 是一种开放协议，允许 AI 模型通过标准化接口调用外部工具。Chatbox Pro 集成 MCP 的目的是让用户可以自由扩展 AI 的能力边界——无需修改应用代码即可接入新工具。

### 传输层架构

MCP 支持两种传输方式，分别解决不同部署场景：

**Stdio 传输**：通过 Main 进程管理子进程。由于浏览器环境无法直接启动子进程，采用 IPC 代理模式——Renderer 侧的 `IPCStdioTransport`（`src/renderer/packages/mcp/ipc-stdio-transport.ts`）通过 Electron IPC 调用 Main 进程中的 `StdioClientTransport`（`src/main/mcp/ipc-stdio-transport.ts`），Main 进程负责子进程的生命周期管理、stderr 日志采集和编码检测。

**HTTP 传输**：直接从 Renderer 发起 HTTP 请求并优先使用 Streamable HTTP。Legacy 模式保留现有 SSE（Server-Sent Events）降级；Auto 模式仅在端点明确返回 404 / 405 时尝试 SSE，认证错误、服务端错误和网络故障不会被误判为协议不兼容。此模式不依赖 Main 进程，因此在 Web 端和移动端同样可用。

### MCP 协议版本策略

- 新建、推荐列表安装和 JSON 导入的自定义 MCP 默认使用 **Auto**：先通过 `server/discover` 协商 2026-07-28 协议；服务端不支持时回退到 legacy `initialize`。
- 升级前已保存且没有 `protocolMode` 的自定义 MCP 按 **Legacy** 处理。用户可以在编辑服务器时手动切换 Auto / Legacy，切换后运行时会重连。
- 2026-07-28 路径当前覆盖工具发现与工具调用主链路。`input_required` 交互、现代订阅以及浏览器环境下的 `x-mcp-header` 参数头镜像暂未接入。
- 少数 stdio 服务收到未知的 `server/discover` 后会直接退出，无法在同一子进程上回退；此类服务应显式选择 Legacy。

### 服务器管理

`mcpController`（`src/renderer/packages/mcp/controller.ts`）是 MCP 服务器的运行时管理中心：

- **生命周期管理**：根据用户配置启动/停止/更新服务器实例，配置变更时自动重连
- **状态订阅**：通过 Emittery 事件系统暴露服务器状态（idle / starting / running / stopping），UI 可实时反映连接状况
- **工具聚合**：共享会话入口 `prepareMCPTools()` 仅从当前配置中已启用、平台支持且已连接的服务器取工具；工具名通过 `mcp__<serverName>__<toolName>` 格式命名以避免冲突
- **错误容忍**：单个 MCP 工具执行失败时返回错误信息而非抛出异常，避免中断整个对话流程

`mcp.servers` 是唯一的持久化服务器清单。平台适配层提供传输依赖，设置页、连接测试和会话工具准备共用传输可用性判断。桌面和 Web 继续使用预连接，移动端继续按需连接；会话的工具资格规则相同。

## Web Search 系统

### 多供应商架构

桌面、Web、Capacitor 和 React Native 入口共用 [Provider 注册表](../../src/shared/services/web-search-providers.ts) 和 [Provider 实现](../../src/shared/services/web-search/)。平台适配层只转换各自保存的设置并注入 HTTP 请求实现：桌面和 Web 使用 `ofetch`，Capacitor 使用 HTTP 插件，React Native 使用 `fetch`。现有设置格式不变。

注册表根据保存的 ID 构造 Provider；认证、参数、请求和响应解析都由 Provider 自己负责。设置页、工具注入和执行层通过实例的 `parseLink()` 是否存在判断能否读取网页，与凭据是否配置好无关。新增实现后注册即可；如果新增持久化字段，还需声明对应的设置字段，不需要修改共享执行流程或维护能力名单。

### 搜索执行流程

[共享搜索服务](../../src/shared/services/web-search/service.ts) 执行实例的 `search()`，透传取消信号，并按调用方策略缓存及裁剪。渲染端保留 5 分钟缓存、最多 10 条结果和 150 字符摘要限制；原生入口仍不缓存。同一个 Provider 如有多个数据源，可复用通用的交替合并函数；哪些数据源启用只由该 Provider 决定。

## Tool 系统（内置工具集）

### Toolset 架构

内置工具定义在 `src/renderer/packages/model-calls/toolsets/` 目录下，每个工具集导出统一结构：

```
{ description: string, tools: ToolSet }
```

其中 `description` 会被注入到系统提示词中，引导模型正确使用工具；`tools` 是 Vercel AI SDK 的工具定义。

### 文件工具集（`toolsets/file.ts`）

为 AI 提供读取和搜索用户上传文件的能力：

- **read_file**：按行号范围读取文件内容（类似 `cat -n`），支持分页，默认 200 行
- **search_file_content**：在文件中搜索关键词，支持上下文行数配置

设计要点：仅对超过阈值行数的大文件启用工具调用；小文件直接内联到上下文中，避免不必要的工具调用开销。

### 知识库工具集（`toolsets/knowledge-base.ts`）

与本地 RAG 知识库交互，提供单个 `knowledge_base` 工具，由 `command` 选择操作：

- **search**：语义搜索，结果带文件 ID、块序号和文件的索引状态
- **read**：从指定块起连续读取若干块；文件未完成索引时说明只有部分块可读
- **list**：分页列出已完成索引的文件及其 ID

工具的 `description` 在每次生成时按知识库名称和已完成索引的文件列表生成，文件不变时保持不变，使模型了解可检索的内容范围。

### Web Search 工具集（`toolsets/web-search.ts`）

暴露两个工具给 AI 模型调用：

- **web_search**：调用上述 Web Search 系统执行搜索
- **parse_link**：抓取并解析指定 URL 的可读内容

`parse_link` 在 `execute` 中调用所选 Provider 实例的 `parseLink()`，不按 Provider ID 分派：

| 提供方 | 执行路径 | 失败模式 |
|--------|---------|---------|
| `tavily` | `getParseLinkProvider().parseLink()` → Tavily `/extract` API | 缺 API key 抛 `tavily_api_key_required`；提取空抛 `parse_link_failed` |
| 其他（`bing` / `bocha` / `querit` / `searxng`） | 不会注入 `parse_link`，模型看不到此工具 | — |

错误抛出采用 AI/用户双层结构：`Error.message`（传给 `ChatboxAIAPIError` 构造器的第一参数）携带技术原因供 AI 推理（例如 "Tavily extract API returned no results for {url}"），`detail.i18nKey` 则给用户渲染本地化的友好提示。

工具的 `execute` 函数透传 `abortSignal`，使用户取消工具执行时能中止底层 HTTP 请求。

### 工具错误的用户可见渲染

工具抛出的 `ChatboxAIAPIError` 在 UI 上有两条独立的渲染路径：

```
tool execute throws ChatboxAIAPIError
        │
        ▼
ai SDK 把异常转成 tool-error chunk
        │
        ▼
stream-chunk-processor.ts
  - 把 chunk.error.message 存到 result.error
  - 把 chunk.error.code (BaseError) 存到 result.errorCode
        │
        ▼
ToolCallPartUI (ParseLinkUI / WebSearchGroupUI / GeneralToolCallUI)
  - state === 'error' 时通过 useAutoExpandOnError() 自动展开详情
  - <ToolCallErrorDetails> 读 result.errorCode
        │
        ▼
<ChatboxAIErrorMessage errorCode={code} />
  - ChatboxAIAPIError.getDetail(code) → i18nKey
  - <Trans> 渲染 OpenSettingButton / OpenExtensionSettingButton /
    OpenMorePlanButton 等可点击的跳转链接
```

`ChatboxAIErrorMessage`（`src/renderer/components/common/ChatboxAIErrorMessage.tsx`）是从 `MessageErrTips` 抽出来的可复用组件，确保同一个 ChatboxAI error code 在「消息级错误」和「工具级错误」两种位置展示一致。如果错误不是已知的 `ChatboxAIAPIError`，组件返回 `null`，`ToolCallErrorDetails` 回退显示原始错误字符串。

## Tool 构建与注入

工具在 AI 生成调用前由 `buildToolsForSession()`（`src/renderer/stores/session/tools-builder.ts`）动态组装，调用方（`agent-harness.ts` 与 `adapters/CurrentGenerationService.ts`）把结果传给模型：

1. **模型能力检查**：Agent 工具需要模型支持 `agent` scope；Web Search 使用独立的 `web-browsing` scope。
2. **Web Search 工具**：当会话启用网页浏览且模型支持 `web-browsing` 时启用，独立于 Agent Mode。
3. **文件工具**：没有 code execution provider 时，为附件文件/链接注入轻量读取工具。
4. **Session Attachment RAG**：当会话已有 attachment ids 且模型支持 `read-file` 时注入。
5. **Agent 工具**：编排层把 Auto 解析为有效的 On/Off；仅当有效模式为 On 且模型支持 `agent` scope 时，注入 code execution、文件系统、MCP、知识库、Skills 和 `user_exec`。
6. **工具说明注入**：各工具集的 `description` 和 Skill 元数据被收集并注入到系统提示词中。

## Agent Skills 与 Tool 构建

Skills 集成沿用 `buildToolsForSession()` 返回的 `{ tools, instructions }` 模式：

1. 在 `instructions` 中注入启用的技能元数据列表
2. 在模型支持 Tool Use 时注册 `load_skill` 工具
3. 由模型在命中场景时再加载技能全文（渐进披露）

这样既保留了技能扩展能力，也避免在每次请求中注入所有技能正文带来的 token 膨胀。

`buildToolsForSession()` 函数（`src/renderer/stores/session/tools-builder.ts`）已实现，统一封装上述逻辑，返回 `{ tools, instructions }` 结构。调用方（`agent-harness.ts` / `adapters/CurrentGenerationService.ts`）使用该函数完成工具组装。

### Skills 相关工具

Agent Mode 下注册 Skills 相关工具：

| 工具 | 说明 | 门控 |
|------|------|------|
| `load_skill` | 按名称加载技能全文指令 | 始终可用（auto 模式初始即可调用） |
| `chatbox_cli` | Chatbox 产品 Skill 的受控虚拟 CLI（账号、只读设置、历史会话、异步生图） | 仅当内置产品 Skill 启用时注入；设置修改由模型引导用户在 UI 中完成；生图使用专属本地化审批卡，批准后等待后台回调而非模型轮询 |
| `user_exec` | 在用户真实环境执行命令，内置审批机制 | Auto 初始隐藏，加载 Skill 后可用 |
| `install_skill` | 从沙箱路径安装技能（需 codeExecution） | code execution 可用时注入，Auto 初始可见 |

`user_exec` 不再在 Auto 初始阶段暴露，避免未加载 Skill 时模型直接尝试操作用户真实环境。`install_skill` 保留为可见工具，用于从已准备好的沙箱路径安装新技能。

### Claude Code Skills 发现

`discoverClaudeSkills()`（`src/main/skills/discovery.ts`）扫描 `~/.claude/skills/` 目录：

- 跟随 symlink（`fs.statSync` + `fs.realpathSync`），按真实路径去重
- 名称规范化为 kebab-case（`normalizeClaudeSkillName`）
- Chatbox Skills 同名时优先（`excludeNames` 参数）
- `source.type` 标记为 `'claude-code'`

### Skills 发现缓存

Renderer 侧缓存发现结果 30 秒（`SKILLS_CACHE_TTL`），避免每次生成发起 IPC 调用。安装/删除技能后调用 `resetSkillsCache()` 强制刷新。

## 已完成的重构

### chatStream 与工具构建

Model Chat Refactor 中的核心部分已落地：

- **chatStream()**：Model 接口已定义 `chatStream()` 方法（`src/shared/models/types.ts`），返回 `AsyncGenerator<ModelStreamPart>`，暴露流式事件（包括工具调用状态和自定义 `status` 事件）
- **buildToolsForSession()**：统一工具构建函数（`src/renderer/stores/session/tools-builder.ts`），根据会话配置和模型能力组装工具集与系统提示词注入指令
- **Orchestration 层**：GenerationService（`packages/chatbox-core/src/generation/GenerationService.ts`，renderer 经 `currentGenerationService` 调用）组合 ContextBuilder → buildToolsForSession → chatStream 完成完整的 AI 调用流程

## Code Execution 工具集（Chat 模式）

Chat 模式引入了第五类工具集——Code Execution 工具集（`toolsets/code-execution.ts`），为 Chat 对话中的 AI 提供代码执行、文件读取和文件生成能力。包含 3 个核心工具：`code_execution`（代码执行）、`read_file`（文件读取，支持行级分页）、`create_download`（文件下载）。另有 3 个 Skills 相关辅助工具：`load_skill`、`user_exec`（用户环境命令执行，含审批机制）、`install_skill`（沙箱安装技能）。

Code Execution 面向 Chat 用户（隐藏底层沙箱细节、自动临时目录、文件上传注入、产物展示），通过 Agent Mode 控制注入。旧的 `sandbox_*` toolset 已移除，历史消息由通用 tool-call UI 按工具名继续渲染。

文件读取和单目录列表通过结构化 Node helper 完成；递归发现和内容搜索使用应用内置 ripgrep；本地产物下载直接走持久化接口。因此核心文件工具在 Windows 上不依赖 Bash 或 WSL。

详细技术设计参见 [`./code-execution.md`](./code-execution.md)。

## 尚未实现的方向

### 统一 ToolRegistry

工具的注册与管理目前仍分散在三个不同位置（MCP 控制器、内置 toolsets、Web Search 包）。架构重构中提出了 **ToolRegistry** 方案，但尚未实现：

- **计划位置**：`src/shared/ai-service/tool-registry/`
- **统一接口**：定义 `AITool` 接口（name, description, parameters, execute），所有工具实现相同接口
- **注册模式**：参考 Provider Registry（`src/shared/providers/registry.ts`）的 `defineProvider()` 模式
- **零 Renderer 依赖**：ToolRegistry 放在 `src/shared/` 下，可独立测试
