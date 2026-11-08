"""Allowlisted client preference forms; never serialize secrets into HTML."""

import copy
import math


LANGUAGES = [("en", "English"), ("zh-Hans", "简体中文"), ("zh-Hant", "繁體中文"),
             ("ja", "日本語"), ("ko", "한국어"), ("ru", "Русский"), ("de", "Deutsch"),
             ("fr", "Français"), ("pt-PT", "Português"), ("es", "Español"),
             ("ar", "العربية"), ("it-IT", "Italiano"), ("sv", "Svenska"), ("nb-NO", "Norsk"), ("tr", "Türkçe")]


def choice(key, label, options, hint=""):
    return dict(key=key, label=label, kind="choice", options=options, hint=hint)


def toggle(key, label, hint=""):
    return choice(key, label, [(True, "开启"), (False, "关闭")], hint)


def number(key, label, minimum, maximum, step, hint=""):
    return dict(key=key, label=label, kind="number", minimum=minimum, maximum=maximum, step=step, hint=hint)


GROUPS = [
    dict(title="界面与语言", description="调整客户端的显示方式，不改变后台控制台语言。", fields=[
        choice("language", "界面语言", LANGUAGES),
        choice("theme", "主题", [(0, "深色"), (1, "浅色"), (2, "跟随系统")]),
        number("fontSize", "字体大小", 10, 22, 1, "10–22 px"),
        choice("startupPage", "启动页面", [("home", "首页"), ("session", "最近会话")]),
        choice("messageLayout", "消息布局", [("bubble", "气泡"), ("left", "左对齐")]),
        toggle("showAvatar", "显示头像"),
    ]),
    dict(title="消息信息", description="选择消息旁显示的辅助信息。", fields=[
        toggle("showModelName", "显示模型名称"), toggle("showMessageTimestamp", "显示发送时间"),
        toggle("showWordCount", "显示字数"), toggle("showTokenCount", "显示估算 Token 数"),
        toggle("showTokenUsed", "显示实际 Token 用量"), toggle("showFirstTokenLatency", "显示首 Token 延迟"),
    ]),
    dict(title="内容与阅读", description="管理内容渲染和阅读体验。", fields=[
        toggle("enableMarkdownRendering", "Markdown 渲染"), toggle("enableMermaidRendering", "Mermaid 图表渲染"),
        toggle("enableLaTeXRendering", "数学公式渲染"), toggle("autoCollapseCodeBlock", "自动折叠代码块"),
        toggle("autoPreviewArtifacts", "自动展开内容预览"), toggle("hideSystemPromptMessage", "隐藏系统提示词消息"),
        toggle("pasteLongTextAsAFile", "将长文本粘贴为文件"), toggle("spellCheck", "拼写检查"),
    ]),
    dict(title="对话习惯", description="这些偏好会在客户端恢复快照后生效。", fields=[
        toggle("autoGenerateTitle", "自动生成会话标题"),
        toggle("injectDefaultMetadata", "注入默认元信息", "包含模型名称、日期等信息。"),
        toggle("autoScrollNewMessagesToTop", "将新消息滚动到顶部"),
        dict(key="defaultPrompt", label="新会话默认系统提示词", kind="text", hint="设定新会话的默认角色与回答方式；留空表示不设置。"),
    ]),
    dict(title="上下文管理", description="控制长对话压缩和工具调用确认。", fields=[
        toggle("autoCompaction", "自动压缩上下文"),
        number("compactionThreshold", "压缩触发比例", 0.4, 0.9, 0.01, "0.40–0.90，例如 0.75 表示达到上下文窗口的 75%。"),
        toggle("pauseOnToolCallLimit", "达到工具调用限制时暂停确认"),
        dict(key="compactionPrompt", label="自定义压缩提示词", kind="text", hint="留空使用客户端默认策略。"),
    ]),
]


def settings_form(form, existing):
    if form.get("settings_form") != "preferences-v1" or "settings" in form:
        raise ValueError("请通过应用设置表单保存，不支持直接提交 JSON")
    value = copy.deepcopy(existing)
    for group in GROUPS:
        for field in group["fields"]:
            key = field["key"]
            if key not in form:
                continue
            raw = form[key]
            if field["kind"] == "choice":
                if raw == "__keep__":
                    continue
                options = {(str(option).lower() if isinstance(option, bool) else str(option)): option for option, _ in field["options"]}
                if raw not in options:
                    raise ValueError(field["label"] + "的选项无效")
                value[key] = options[raw]
                if key == "language" and value[key] != existing.get(key):
                    value["languageInited"] = True
            elif field["kind"] == "number":
                if not raw.strip():
                    continue
                try:
                    parsed = float(raw)
                except ValueError:
                    raise ValueError(field["label"] + "必须是数字") from None
                if not math.isfinite(parsed) or not field["minimum"] <= parsed <= field["maximum"] or (field["step"] == 1 and not parsed.is_integer()):
                    raise ValueError(field["label"] + "超出允许范围")
                value[key] = int(parsed) if field["step"] == 1 else parsed
            else:
                if len(raw) > 20000:
                    raise ValueError(field["label"] + "不能超过 20000 个字符")
                if raw or key in existing:
                    value[key] = raw
    return value