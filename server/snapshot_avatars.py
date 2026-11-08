"""Read only assistant-referenced raster avatars, never remote URLs or files."""

import base64
import binascii

try:
    from .snapshot_validation import decode
except ImportError:
    from snapshot_validation import decode

MAX_AVATAR_BYTES = 8 * 1024 * 1024


def raster(content):
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def data_image(value):
    if not isinstance(value, str) or not value.startswith("data:image/") or len(value) > MAX_AVATAR_BYTES * 4 // 3 + 1024:
        return None
    header, separator, body = value.partition(",")
    if not separator or not header.endswith(";base64"):
        return None
    try:
        content = base64.b64decode(body, validate=True)
    except (binascii.Error, ValueError):
        return None
    mime = raster(content)
    return (content, mime) if mime and len(content) <= MAX_AVATAR_BYTES else None


def resource_index(db):
    row = db.execute("SELECT data FROM archive_entries WHERE path='resources.jsonl'").fetchone()
    return {record["resourceId"]: record for line in (row[0].splitlines() if row else []) if line.strip()
            for record in [decode(line)]}


def assistant_avatar(db, item, resources):
    avatar = item.get("avatar")
    if not isinstance(avatar, dict):
        return data_image(item.get("picUrl"))
    if avatar.get("type") == "url":
        return data_image(avatar.get("url"))  # No server fetches or external browser requests.
    if avatar.get("type") != "storage-key":
        return None
    resource = resources.get(avatar.get("storageKey"))
    if not resource or resource["size"] > MAX_AVATAR_BYTES:
        return None
    row = db.execute("SELECT data FROM archive_entries WHERE path=? AND length(data)<=?", (resource["path"], MAX_AVATAR_BYTES)).fetchone()
    if not row:
        return None
    content = row[0]
    if resource["contentType"] == "text":
        try:
            return data_image(content.decode("utf-8"))
        except UnicodeError:
            return None
    mime = raster(content)
    return (content, mime) if mime else None