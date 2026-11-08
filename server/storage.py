"""本地存储：普通 SQL、短事务，不依赖 Flask，也不读取客户端私有数据。"""

import json
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

MAX_AVATAR_BYTES = 2 * 1024 * 1024
AVATAR_NAME = re.compile(r"[0-9a-f]{32}\.(png|jpg|gif|webp)\Z")
DEFAULTS = {
    "remote": {"setting_chatboxai_first": False, "current_version": "", "product_ids": []},
    "models": {},
    "rag": {
        "models": {"embedding": "", "rerank": ""},
        "capabilities": {"session_attachment_embedding": False, "session_attachment_rerank": False},
    },
}


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def validate_config(kind, value):
    """只校验本服务提供的配置结构；不执行模型、不验证远程服务。"""
    if kind not in DEFAULTS or not isinstance(value, dict):
        raise ValueError("配置必须是已知类别的 JSON 对象")
    encode(value)
    if kind == "remote":
        allowed = {*DEFAULTS["remote"], "knowledge_base_models"}
        if set(value) - allowed:
            raise ValueError("未知的应用配置键")
        if type(value.get("setting_chatboxai_first")) is not bool:
            raise ValueError("setting_chatboxai_first 必须为布尔值")
        if not isinstance(value.get("current_version"), str):
            raise ValueError("current_version 必须为字符串")
        ids = value.get("product_ids")
        if not isinstance(ids, list) or any(type(x) is not int for x in ids):
            raise ValueError("product_ids 必须为整数数组")
        if "knowledge_base_models" in value:
            models = value["knowledge_base_models"]
            if not isinstance(models, dict) or set(models) != {"embedding", "vision", "rerank"} or any(not isinstance(x, str) for x in models.values()):
                raise ValueError("knowledge_base_models 需要 embedding、vision、rerank 字符串")
    elif kind == "rag":
        if set(value) != {"models", "capabilities"}:
            raise ValueError("RAG 需要 models 和 capabilities")
        models, caps = value["models"], value["capabilities"]
        if not isinstance(models, dict) or set(models) != {"embedding", "rerank"} or any(not isinstance(x, str) for x in models.values()):
            raise ValueError("RAG models 需要 embedding 和 rerank 字符串")
        if not isinstance(caps, dict) or set(caps) != set(DEFAULTS["rag"]["capabilities"]) or any(type(x) is not bool for x in caps.values()):
            raise ValueError("RAG capabilities 需要两个布尔值")
    else:
        for provider, manifest in value.items():
            if not isinstance(provider, str) or not provider or not isinstance(manifest, dict):
                raise ValueError("模型配置按提供商名称分组")
            if set(manifest) != {"groupName", "models", "imageModels"} or not isinstance(manifest["groupName"], str):
                raise ValueError("模型组需要 groupName、models、imageModels")
            for field in ("models", "imageModels"):
                if not isinstance(manifest[field], list):
                    raise ValueError("模型列表必须为数组")
                for model in manifest[field]:
                    if not isinstance(model, dict) or any(not isinstance(model.get(k), str) or not model[k] for k in ("modelId", "modelName")):
                        raise ValueError("每个模型需要 modelId 和 modelName")


def validate_assistant(value):
    for key, maximum in (("id", 200), ("name", 200), ("description", 4000), ("prompt", 100000), ("lang", 40)):
        text = value.get(key)
        if not isinstance(text, str) or len(text) > maximum or (key in {"id", "name", "lang"} and not text.strip()):
            raise ValueError(f"{key} 为空或超出长度限制")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value["lang"]):
        raise ValueError("语言代码只能包含字母、数字、下划线和连字符")
    if value["id"] in {".", ".."} or not re.fullmatch(r"[A-Za-z0-9:._-]+", value["id"]):
        raise ValueError("ID 只能包含字母、数字、冒号、点、下划线和连字符")
    tags = value.get("tags")
    if not isinstance(tags, list) or len(tags) > 50 or any(not isinstance(t, str) or not t.strip() or len(t) > 100 for t in tags):
        raise ValueError("标签最多 50 个，每个为 1–100 字符")
    if type(value.get("enabled")) is not bool:
        raise ValueError("enabled 必须为布尔值")
    avatar = value.get("avatar_filename")
    if avatar is not None and (not isinstance(avatar, str) or not AVATAR_NAME.fullmatch(avatar)):
        raise ValueError("头像文件名无效")


def avatar_type(filename, content):
    """扩展名和文件头必须相符；这是格式筛查，不是完整图片解码器。"""
    if not content or len(content) > MAX_AVATAR_BYTES:
        raise ValueError("头像必须为 1 字节至 2 MiB")
    suffix = Path(filename).suffix.lower()
    if suffix == ".png" and content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if suffix in {".jpg", ".jpeg"} and content.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if suffix == ".gif" and content[:6] in {b"GIF87a", b"GIF89a"}:
        return "gif"
    if suffix == ".webp" and len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "webp"
    raise ValueError("仅允许文件头匹配的 PNG、JPEG、GIF、WebP，不允许 SVG")


class Storage:
    def __init__(self, data_dir):
        self.directory = Path(data_dir).expanduser().resolve()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.uploads = self.directory / "uploads"
        if self.uploads.is_symlink():
            raise ValueError("uploads 不能为符号链接")
        self.uploads.mkdir(exist_ok=True, mode=0o700)
        self.database = self.directory / "chatbox.sqlite3"
        if self.database.is_symlink():
            raise ValueError("数据库不能为符号链接")
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS config (name TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS assistants (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
                    prompt TEXT NOT NULL, tags TEXT NOT NULL, lang TEXT NOT NULL,
                    avatar_filename TEXT, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
                    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS assistants_language ON assistants(enabled, lang, id);
                CREATE INDEX IF NOT EXISTS assistants_avatar ON assistants(avatar_filename);
            """)
            for name, value in DEFAULTS.items():
                db.execute("INSERT OR IGNORE INTO config VALUES (?, ?)", (name, encode(value)))
            db.execute("INSERT OR IGNORE INTO metadata VALUES ('session_secret', ?)", (secrets.token_hex(32),))
        self.database.chmod(0o600)

    @contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.database, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            if write:
                db.execute("BEGIN IMMEDIATE")
            with db:
                yield db
        finally:
            db.close()

    def secret(self):
        with self.connect() as db:
            return db.execute("SELECT value FROM metadata WHERE name='session_secret'").fetchone()[0]

    def config(self, name):
        with self.connect() as db:
            row = db.execute("SELECT value FROM config WHERE name=?", (name,)).fetchone()
            if row is None:
                raise ValueError("未知配置类别")
            return json.loads(row[0])

    def set_config(self, name, value):
        validate_config(name, value)
        with self.connect(write=True) as db:
            db.execute("UPDATE config SET value=? WHERE name=?", (encode(value), name))

    @staticmethod
    def assistant(row):
        if row is None:
            return None
        result = dict(row)
        result["tags"] = json.loads(result["tags"])
        result["enabled"] = bool(result["enabled"])
        return result

    def get(self, assistant_id):
        with self.connect() as db:
            return self.assistant(db.execute("SELECT * FROM assistants WHERE id=?", (assistant_id,)).fetchone())

    def all(self, enabled_only=False, lang=None):
        # SQL 片段为常量，用户输入只进入参数。
        clauses, parameters = [], []
        if enabled_only:
            clauses.append("enabled=1")
        if lang:
            clauses.append("lang=?")
            parameters.append(lang)
        query = "SELECT * FROM assistants" + (" WHERE " + " AND ".join(clauses) if clauses else "") + " ORDER BY id COLLATE BINARY"
        with self.connect() as db:
            return [self.assistant(row) for row in db.execute(query, parameters)]

    def save(self, value, original_id=None):
        validate_assistant(value)
        old_avatar = None
        with self.connect(write=True) as db:
            old = db.execute("SELECT * FROM assistants WHERE id=?", (original_id,)).fetchone() if original_id is not None else None
            if original_id is not None and old is None:
                raise ValueError("助手不存在")
            if value["avatar_filename"] and self.avatar_path(value["avatar_filename"]) is None:
                raise ValueError("头像文件不存在")
            now = int(time.time() * 1000)
            params = (value["id"], value["name"], value["description"], value["prompt"], encode(value["tags"]), value["lang"], value["avatar_filename"], int(value["enabled"]), old["created_at"] if old else now, now)
            if old:
                old_avatar = old["avatar_filename"]
                db.execute("UPDATE assistants SET id=?, name=?, description=?, prompt=?, tags=?, lang=?, avatar_filename=?, enabled=?, created_at=?, updated_at=? WHERE id=?", (*params, original_id))
            else:
                db.execute("INSERT INTO assistants VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params)
        self.remove_unreferenced(old_avatar)

    def delete(self, assistant_id):
        with self.connect(write=True) as db:
            row = db.execute("SELECT avatar_filename FROM assistants WHERE id=?", (assistant_id,)).fetchone()
            if row is None:
                raise ValueError("助手不存在")
            db.execute("DELETE FROM assistants WHERE id=?", (assistant_id,))
        self.remove_unreferenced(row[0])

    def import_batch(self, values):
        """离线批量导入，任意重复 ID 或无效条目都会回滚整个数据库事务。"""
        for value in values:
            validate_assistant(value)
        with self.connect(write=True) as db:
            now = int(time.time() * 1000)
            for value in values:
                if value["avatar_filename"] and self.avatar_path(value["avatar_filename"]) is None:
                    raise ValueError("头像文件不存在")
                db.execute("INSERT INTO assistants VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (
                    value["id"], value["name"], value["description"], value["prompt"], encode(value["tags"]),
                    value["lang"], value["avatar_filename"], int(value["enabled"]), now, now,
                ))

    def upload(self, filename, content):
        name = uuid.uuid4().hex + "." + avatar_type(filename, content)
        # 独占创建；绝不使用客户端文件名作为磁盘路径。
        path = self.uploads / name
        with path.open("xb") as file:
            try:
                file.write(content)
            except BaseException:
                path.unlink(missing_ok=True)
                raise
        path.chmod(0o600)
        return name

    def avatar_path(self, name):
        if not isinstance(name, str) or not AVATAR_NAME.fullmatch(name):
            return None
        path = self.uploads / name
        if path.is_symlink() or not path.is_file() or path.resolve().parent != self.uploads:
            return None
        return path

    def is_referenced(self, name):
        with self.connect() as db:
            return db.execute("SELECT 1 FROM assistants WHERE avatar_filename=? LIMIT 1", (name,)).fetchone() is not None

    def remove_unreferenced(self, name):
        if not name:
            return
        # 再次取得写锁，避免删除其他助手仍引用的文件。只在数据库提交后清理。
        with self.connect(write=True) as db:
            if not db.execute("SELECT 1 FROM assistants WHERE avatar_filename=? LIMIT 1", (name,)).fetchone():
                path = self.avatar_path(name)
                if path:
                    try:
                        path.unlink()
                    except OSError:
                        # 清理失败保留孤儿文件，离线 gc 可重试，不撤销已提交的 CRUD。
                        pass

    def collect_orphans(self):
        """仅在服务停止时手动运行；崩溃可能留下尚未关联的上传文件。"""
        for path in self.uploads.iterdir():
            if AVATAR_NAME.fullmatch(path.name):
                self.remove_unreferenced(path.name)