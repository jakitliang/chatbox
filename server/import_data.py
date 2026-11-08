"""明确授权后的离线导入；不连接网络、不覆盖已有助手、不读取默认旧仓库。"""

import argparse
import json
import os
import sqlite3
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

try:
    from .storage import MAX_AVATAR_BYTES, Storage, validate_assistant
except ImportError:
    from storage import MAX_AVATAR_BYTES, Storage, validate_assistant


def relative_avatar(root, source):
    """只认可本地相对路径或旧服务的已知头像前缀，逐级拒绝符号链接。"""
    if not isinstance(source, str) or "\\" in source or "%" in source:
        raise ValueError("头像路径无效")
    for prefix in ("/static/api/avatar/", "/api/avatar/"):
        if source.startswith(prefix):
            source = source[len(prefix):]
            break
    parsed = urlsplit(source)
    parts = PurePosixPath(source)
    if not source or parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or parts.is_absolute() or any(p in {".", "..", ""} for p in source.split("/")):
        raise ValueError("头像必须是没有 .. 的本地相对路径，不接受远程 URL")
    root = Path(root).expanduser().resolve(strict=True)
    current = root
    for part in parts.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("头像路径不能包含符号链接")
    resolved = current.resolve(strict=True)
    if root not in resolved.parents or not resolved.is_file():
        raise ValueError("头像路径超出指定目录或不是文件")
    return resolved


def import_owned(storage, json_file, avatar_dir=None, lang="zh-Hans"):
    source = Path(json_file).expanduser()
    with source.open("rb") as file:
        content = file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise ValueError("JSON 文件最多 10 MiB")
    document = json.loads(content)
    items = document.get("data") if isinstance(document, dict) else document
    if not isinstance(items, list):
        raise ValueError("JSON 必须为助手数组或 {data: 数组}")
    values, created = [], []
    try:
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("助手条目必须为对象")
            value = {key: item.get(key, "") for key in ("id", "name", "description", "prompt")}
            value.update(tags=item.get("tags", []), lang=item.get("lang", lang), enabled=item.get("enabled", True), avatar_filename=None)
            validate_assistant(value)
            avatar = item.get("avatar")
            source_name = item.get("avatar_filename") or (avatar.get("url") if isinstance(avatar, dict) and avatar.get("type") == "url" else None) or item.get("picUrl")
            if source_name:
                if avatar_dir is None:
                    raise ValueError("存在头像引用时必须明确指定 --avatars")
                path = relative_avatar(avatar_dir, source_name)
                with path.open("rb") as file:
                    name = storage.upload(path.name, file.read(MAX_AVATAR_BYTES + 1))
                created.append(name)
                value["avatar_filename"] = name
            values.append(value)
        storage.import_batch(values)
    except BaseException:
        for name in created:
            storage.remove_unreferenced(name)
        raise
    return len(values)


def main():
    parser = argparse.ArgumentParser(description="服务停止后执行本地导入或孤儿头像清理")
    parser.add_argument("--data-dir", default=os.environ.get("CHATBOX_SERVER_DATA_DIR", str(Path(__file__).resolve().parent / "data")))
    commands = parser.add_subparsers(dest="command", required=True)
    importer = commands.add_parser("import", help="只导入自己拥有或获授权的内容")
    importer.add_argument("json_file")
    importer.add_argument("--avatars")
    importer.add_argument("--lang", default="zh-Hans")
    importer.add_argument("--confirm-owned", action="store_true", required=True, help="确认拥有内容或已获导入授权")
    commands.add_parser("gc", help="清理无数据库引用的 UUID 头像；必须先停止服务")
    args = parser.parse_args()
    storage = Storage(args.data_dir)
    try:
        if args.command == "gc":
            storage.collect_orphans()
            print("孤儿头像清理完成")
        else:
            count = import_owned(storage, args.json_file, args.avatars, args.lang)
            print(f"已导入 {count} 个助手")
    except (ValueError, OSError, sqlite3.IntegrityError):
        parser.exit(1, "导入失败：请检查 JSON、ID 唯一性和本地头像路径；数据库导入已回滚。\n")


if __name__ == "__main__":
    main()