"""Typed HTML form parsing; users never need to edit serialized configuration."""

import copy
import re


def text(form, key, maximum=200, required=False):
    value = form.get(key, "").strip()
    if len(value) > maximum or (required and not value):
        raise ValueError("请填写必填字段，并检查内容长度")
    return value


def provider_id(form):
    value = text(form, "provider", required=True)
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value) or value == "chatbox-ai":
        raise ValueError("提供商 ID 仅允许字母、数字、横线和下划线，不能使用官方商业提供商")
    return value


def config_form(kind, form, existing):
    value = copy.deepcopy(existing)
    if kind == "remote":
        value.update(setting_chatboxai_first=False, product_ids=[], current_version=text(form, "current_version", 80))
        fields = {key: text(form, "kb_" + key) for key in ("embedding", "vision", "rerank")}
        if any(fields.values()) or "knowledge_base_models" in value:
            value["knowledge_base_models"] = fields
    elif kind == "rag":
        value["models"] = {key: text(form, key) for key in ("embedding", "rerank")}
        value["capabilities"] = {key: key in form for key in ("session_attachment_embedding", "session_attachment_rerank")}
        for capability, model in (("session_attachment_embedding", "embedding"), ("session_attachment_rerank", "rerank")):
            if value["capabilities"][capability] and not value["models"][model]:
                raise ValueError("启用能力前，请先填写对应模型 ID")
    else:
        raise ValueError("请选择具体提供商或模型进行编辑")
    return value


def model_form(form, existing=None, image=False):
    value = copy.deepcopy(existing or {})
    value.update(modelId=text(form, "modelId", required=True), modelName=text(form, "modelName", required=True))
    for key, maximum in (("description", 4000), ("apiStyle", 40), ("type", 40)):
        field = text(form, key, maximum)
        if field:
            value[key] = field
        else:
            value.pop(key, None)
    if value.get("apiStyle") not in (None, "google", "openai", "openai-responses", "anthropic"):
        raise ValueError("接口格式无效")
    if value.get("type") not in (None, "chat", "embedding", "rerank", "image"):
        raise ValueError("模型类型无效")
    if image:
        value["type"] = "image"
    window = text(form, "contextWindow", 10)
    if window:
        if not window.isascii() or not window.isdigit() or not 1 <= int(window) <= 10000000:
            raise ValueError("上下文窗口必须是 1 到 10000000 的整数")
        value["contextWindow"] = int(window)
    else:
        value.pop("contextWindow", None)
    labels = list(dict.fromkeys(label.strip() for label in text(form, "labels", 2000).split(",") if label.strip()))
    if labels:
        value["labels"] = labels
    else:
        value.pop("labels", None)
    capabilities = [key for key in ("vision", "tool_use", "reasoning") if key in form]
    if capabilities:
        value["capabilities"] = capabilities
    else:
        value.pop("capabilities", None)
    return value