# 思考控制（Reasoning Control）

## 1. 能力来源：供应商设置中保存的 capabilities

模型供应商设置里持久化的 `capabilities` 是运行时能力判定的唯一来源，包含用户手动勾选或取消的结果。
`reasoning` 是否勾选决定思考控件是否显示、请求是否允许携带思考参数；模型名称不是能力白名单。
Vision、Tool use 等能力同样以保存的配置为准，不能在通用请求链路按模型名称重新判定。

- **已勾选 reasoning**：显示控件，按协议生成参数；未知模型名不能否决用户选择。
- **未勾选 reasoning**：隐藏控件，并在请求边界移除思考命名空间参数。
- 取消勾选不是发送“关闭思考”指令，也不保证服务端停止推理；省略参数后采用服务端默认行为。
- 该能力只控制请求，不过滤返回内容，也不决定是否展示服务端已返回的思考内容。

## 2. 显式刷新与运行时补全

显式获取／刷新模型列表时，所有供应商统一通过 `refreshProviderModelCapabilities()` 更新已保存模型的能力，
不再仅对 Ollama 生效。已有模型行不触发新增回调，因此刷新流程也会直接持久化它们的新能力。

- 已知能力元数据更新保存值，包括明确的空数组 `[]`；显式刷新可以覆盖此前的手动选择。
- 能力元数据缺失（`undefined`）表示未知，不等于“不支持”，应保留已有保存值。
- 新模型可以用供应商返回值或目录元数据初始化能力；供应商已提供的能力优先于目录默认值。
- 未知能力不会阻止用户手动勾选；用户随后保存的配置继续作为运行时依据。
- 普通运行时 registry enrichment **绝不覆盖 capabilities**，也不按模型名补勾能力。
- registry 仍可用有效数值补全／更新 `contextWindow`、`maxOutput` 等限制，不能因此恢复已取消的勾选。

## 3. 能力判定与协议适配分离

`getReasoningControlCapabilities()` 先检查保存的 `reasoning`，再选择控制形态。
`ReasoningStrategy` 与供应商适配层只负责 effort、budget、toggle 的选项、归一化和 wire 格式，
不能用模型名白名单或 API 风格不匹配重新否决已勾选的能力。

保留必要的模型级协议差异：例如 Claude adaptive thinking、Gemini budget／level、
OpenAI 合法 effort 值及不可关闭的模型、DeepSeek V4 的强度参数。
这些分支回答“参数怎样发送”，不是“模型是否具备能力”。
未知模型使用当前供应商／协议的既有控制形态；未知 Gemini 名称不会再把显式配置的 `thinkingConfig` 丢弃。

ChatboxAI、OpenCode Zen／Go、自建供应商等代理路径通过模型 `apiStyle` 选择有效协议：

| apiStyle | 协议适配 |
|---|---|
| `anthropic` | Claude / Anthropic Messages |
| `google` | Gemini |
| `openai-responses` | OpenAI Responses |
| `openai` 或缺省兜底 | OpenAI Chat Completions |

供应商类型提供 API 风格兜底，网关模型元数据可以进一步指定实际风格；OpenRouter 保留自己的协议。
这些映射仅用于序列化，不能取代保存的能力设置。

## 4. 各供应商协议示例

FastFlowLM 的手动模型刷新会将 `flm.reasoning_effort` 保存为模型元数据 `reasoningEffortLevels`。
模型实例的 `getReasoningOptions()` 可以读取这份数据，不需要再次请求目录；现有聊天菜单和请求档位还没有接入该方法。

下表为内部 `providerOptions` 与最终协议的典型映射，不是支持模型清单。

| 路径 | 思考参数示例 |
|---|---|
| OpenAI / Responses / Azure | `openai.reasoningEffort`；适配为 Chat 的 `reasoning_effort` 或 Responses 的 `reasoning.effort` |
| Claude | `claude.thinking` 的 token budget，或 `claude.effort`；模型分支负责 enabled／adaptive 与 `output_config.effort` |
| Gemini | `google.thinkingConfig.thinkingBudget` 或 `thinkingLevel`，保留各模型合法档位适配 |
| Qwen / 通用兼容开关策略 | `openaiCompatible.enable_thinking` 布尔值，由策略归一化并写入兼容请求 |
| xAI | 通过 `openai.reasoningEffort` 传递强度，保留供应商协议限制 |
| OpenRouter | `openrouter.reasoning`，例如 `effort`、`enabled`、`exclude` |

OpenAI 的 `forceReasoning` 是 SDK 适配标志，使已配置能力的未知模型也能序列化参数，不应泄漏给兼容接口。
协议本身不支持某种参数或无法关闭思考时，仍保留原有合法值映射和选项限制。

### DeepSeek

DeepSeek V4 的 UI 低／中／高映射为官方 `low / high / max`；V4 之前的模型只发送 thinking 开关，
不能附加 V4 专属强度参数。ChatboxAI 使用模型目录返回的实际 `apiStyle`，不假设一定走 Anthropic。

| API 风格 | 开启与强度 | 显式 off |
|---|---|---|
| OpenAI Chat | `thinking: { type: 'enabled' }` + V4 的 `reasoning_effort` | `thinking: { type: 'disabled' }` |
| Anthropic | `thinking: { type: 'enabled' }` + V4 的 `output_config.effort` | `thinking: { type: 'disabled' }` |
| Responses（V4） | `reasoning: { effort }` | `reasoning: { effort: 'none' }` |

ChatboxAI 的 DeepSeek API 风格变化时，生成新配置前清除旧思考命名空间，避免混发多套协议。
DeepSeek 的历史消息、`reasoning_content` 回传和响应解析保持原有处理，不因能力勾选或控制策略改写、删除或过滤。

## 5. 按模型持久化；default 不等于 off

思考配置保存在 `session.settings.providerOptionsByModel`，键为 `${provider}:${modelId}`。
`setReasoningProviderOptionsForModel()` 写入，`resolveReasoningProviderOptions()` 只读取当前模型的条目。
切换模型不继承另一模型的参数，切回时恢复该模型偏好；没有条目即 `default`。
旧扁平字段 `session.settings.providerOptions` 不再读取，写入时清空，仅保留 schema 解析兼容。

- **default**：移除思考命名空间，不发送思考参数，采用服务端默认值。
- **off**：用户显式选择关闭，发送协议允许的关闭值或最低档；不等于取消能力勾选。
- 例如 OpenAI 按模型使用 `none`／`minimal`，Claude 使用 disabled，Gemini 使用零 budget 或最低 level，兼容开关使用 `false`。
- 不支持显式关闭的协议／模型不提供 off；已有 off 值按 default 处理，不强造非法参数。

## 6. 请求边界与维护入口

`AbstractAISDKModel.resolveCallSettings()` 通过 `isSupportReasoning()` 读取保存的能力。
未勾选时先调用 `stripReasoningProviderOptions()`；勾选时才执行策略归一化，不再按模型名做能力 gate。
流式与非流式生成共用此边界，避免历史／同步残留参数绕过设置。

清理覆盖 `claude`、`openai`、`google`、`deepseek`、`openaiCompatible`、`openrouter` 思考命名空间，
仅处理请求选项，不注入 disabled 参数，不修改历史消息、响应内容或展示逻辑。

维护时区分三个入口：能力更新在模型发现／显式刷新流程，能力判定读取持久化配置，
新增协议差异放入现有 strategy／供应商适配模块；不要重新引入模型名能力白名单。
