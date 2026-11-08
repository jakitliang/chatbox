"""Validate the SQLite envelope and portable V3 entries without executing client SQL."""

import json
import math
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from urllib.parse import quote, unquote

try:
    from .sync_store import MAX
except ImportError:
    from sync_store import MAX

CONFIGS = {"settings.json", "copilots.json", "session-settings.json"}
GROUPS = {
    "chat-session-settings": "sessions", "picture-session-settings": "sessions",
    "session-folders": "sessions", "agent-soul": "settings", "agent-memories": "settings",
    "copilot-memories": "copilots", "copilot-memory-owners": "copilots",
    "copilot-memory-state-tokens": "copilots",
}
RESOURCE = re.compile(r"resources/[0-9]{6}\.[a-z0-9]{1,10}\Z", re.ASCII)
COUNT_KEYS = {"session", "thread", "message", "global", "resource", "warning"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def decode(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result
    def invalid(_):
        raise ValueError("Nonfinite JSON number")
    def finite_float(value):
        number = float(value)
        require(math.isfinite(number), "Nonfinite JSON number")
        return number
    try:
        return json.loads(data.decode("utf-8-sig"), object_pairs_hook=unique, parse_constant=invalid, parse_float=finite_float)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError("Invalid UTF-8 JSON") from error


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def identity(value):
    require(isinstance(value, dict) and isinstance(value.get("id"), str) and 0 < len(value["id"]) <= 4096, "Missing item ID")
    return value["id"]


def collection(value):
    require(isinstance(value, list), "Configuration collection must be an array")
    identifiers = [identity(item) for item in value]
    require(len(set(identifiers)) == len(identifiers), "Duplicate configuration ID")
    return len(value)


def configuration_count(path, value, selection):
    if path == "settings.json":
        require(selection["settings"] and isinstance(value, dict), "Invalid settings scope or object")
        return 1
    if path == "copilots.json":
        require(selection["copilots"], "Invalid copilots scope")
        count = collection(value)
        for item in value:
            require(isinstance(item.get("name"), str) and isinstance(item.get("prompt"), str), "Invalid assistant name/prompt")
            require("category" not in item or isinstance(item["category"], str), "Invalid assistant category")
        return count
    require(isinstance(value, dict), "Shared configuration must be an object")
    count = 0
    for key, item in value.items():
        require(key in GROUPS and selection[GROUPS[key]], "Unknown or unselected shared configuration key")
        if key in {"chat-session-settings", "picture-session-settings", "agent-soul"}:
            count += 1
        elif key == "copilot-memories":
            require(isinstance(item, dict) and all(isinstance(v, list) for v in item.values()), "Invalid copilot memories")
            count += len(item)
        else:
            count += collection(item)
    return count


def session_id(path):
    match = re.fullmatch(r"sessions/([^/]+)\.jsonl", path)
    require(match is not None, "Invalid session path")
    encoded = match[1]
    try:
        identifier = unquote(encoded, errors="strict")
    except UnicodeError as error:
        raise ValueError("Invalid encoded session ID") from error
    # urllib always leaves dots unescaped; layout.ts explicitly encodes them.
    canonical = quote(identifier, safe="-_~").replace(".", "%2E")
    if re.fullmatch(r"con|prn|aux|nul|com[0-9]|lpt[0-9]", canonical, re.I):
        canonical = "%" + format(ord(canonical[0]), "02X") + canonical[1:]
    require(bool(identifier) and len(encoded) <= 200 and canonical == encoded, "Noncanonical session path")
    return identifier


@contextmanager
def readonly(path):
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        db.execute("PRAGMA trusted_schema=OFF")
        db.execute("PRAGMA query_only=ON")
        # Bound CPU work on hostile pages/records; SQLite extensions are never enabled.
        budget = [0]
        def progress():
            budget[0] += 1
            return int(budget[0] > 100000)
        db.set_progress_handler(progress, 1000)
        yield db
    finally:
        db.close()


def check_schema(db):
    require(db.execute("PRAGMA user_version").fetchone()[0] == 1, "SQLite user_version must be 1")
    require(db.execute("PRAGMA journal_mode").fetchone()[0] != "wal", "Snapshot must be a standalone, non-WAL SQLite file")
    expected = {"archive_entries": ("path", "TEXT", "data", "BLOB"), "snapshot_meta": ("key", "TEXT", "value", "TEXT")}
    found = set()
    for kind, name, table, sql in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master"):
        if kind == "index" and sql is None and name == "sqlite_autoindex_" + table + "_1" and table in expected:
            continue
        require(kind == "table" and name in expected and table == name, "Unsafe/extra SQLite schema object")
        first, first_type, second, second_type = expected[name]
        normalized = re.sub(r'[\s"`\[\]]+', '', sql or '').lower().rstrip(';')
        base = f"createtable{name}({first}{first_type}primarykey,{second}{second_type}notnull)".lower()
        base_notnull = f"createtable{name}({first}{first_type}notnullprimarykey,{second}{second_type}notnull)".lower()
        require(normalized in {base, base + "withoutrowid", base + "strict", base_notnull, base_notnull + "withoutrowid", base_notnull + "strict"}, "Unsafe table definition")
        columns = db.execute(f"PRAGMA table_xinfo({name})").fetchall()
        require(len(columns) == 2 and columns[0][1:3] == (first, first_type) and columns[0][5] == 1 and columns[0][4] is None and columns[0][6] == 0 and columns[1][1:7] == (second, second_type, 1, None, 0, 0), "Invalid table columns")
        found.add(name)
    require(found == set(expected), "Missing SQLite table")
    require(db.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "SQLite integrity check failed")
    require(db.execute("SELECT count(*) FROM archive_entries WHERE typeof(path)!='text' OR typeof(data)!='blob'").fetchone()[0] == 0, "Invalid archive row types")
    require(db.execute("SELECT count(*) FROM snapshot_meta WHERE typeof(key)!='text' OR typeof(value)!='text'").fetchone()[0] == 0, "Invalid metadata types")


def entries_statistics(db):
    lengths = dict(db.execute("SELECT path,length(data) FROM archive_entries"))
    require(3 <= len(lengths) <= 65534 and sum(lengths.values()) <= MAX, "Entry capacity exceeded")
    require({"manifest.json", "complete.json", "resources.jsonl"} <= lengths.keys(), "Missing V3 control entries")
    def entry(path):
        return db.execute("SELECT data FROM archive_entries WHERE path=?", (path,)).fetchone()[0]
    require(lengths["manifest.json"] <= 65536 and lengths["complete.json"] <= 65536, "Control entry too large")
    manifest = decode(entry("manifest.json"))
    require(isinstance(manifest, dict) and set(manifest) == {"format", "formatVersion", "layout", "archiveId", "createdAt", "producer", "selection"}, "Invalid V3 manifest")
    require(manifest["format"] == "chatbox-backup" and type(manifest["formatVersion"]) is int and manifest["formatVersion"] == 3 and manifest["layout"] == "rows", "Unsupported V3 format")
    for key in ("archiveId", "producer"):
        require(isinstance(manifest[key], str) and 0 < len(manifest[key]) <= 4096, "Invalid manifest identity")
    require(isinstance(manifest["createdAt"], str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z", manifest["createdAt"]), "Invalid manifest timestamp")
    try:
        datetime.fromisoformat(manifest["createdAt"].replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("Invalid manifest timestamp") from error
    selection = manifest["selection"]
    require(isinstance(selection, dict) and set(selection) == {"sessions", "settings", "copilots", "credentials"} and all(type(v) is bool for v in selection.values()), "Invalid selection")
    require(not selection["credentials"] or selection["settings"], "Credentials require settings")
    for group, path in (("settings", "settings.json"), ("copilots", "copilots.json")):
        require(not selection[group] or path in lengths, "Selected configuration is missing")
    counts = dict.fromkeys(COUNT_KEYS, 0)
    resources = set()
    resource_ids = set()
    folded = set()
    for path, size in lengths.items():
        if path in {"manifest.json", "complete.json"} or RESOURCE.fullmatch(path):
            continue
        if path in CONFIGS:
            require(size <= 64 * 1024 * 1024, "Configuration too large")
            counts["global"] += configuration_count(path, decode(entry(path)), selection)
            continue
        require(path in {"resources.jsonl", "warnings.jsonl"} or path.startswith("sessions/"), "Unexpected archive path")
        sid = session_id(path) if path.startswith("sessions/") else None
        if sid is not None:
            require(selection["sessions"] and path.lower() not in folded, "Unselected or colliding session")
            folded.add(path.lower())
        session_count = 0
        # Entries are bounded by the 256 MiB envelope; individual JSON rows by 16 MiB.
        for line in entry(path).splitlines():
            if not line.strip():
                continue
            require(len(line) <= 16 * 1024 * 1024, "Record too large")
            record = decode(line)
            require(isinstance(record, dict), "Record must be an object")
            kind = record.get("type")
            require(isinstance(kind, str), "Record type must be a string")
            if sid is not None:
                require(kind in {"session", "thread", "message"} and isinstance(record.get(kind), dict), "Invalid session record")
                payload = record[kind]
                require((payload.get("id") if kind == "session" else payload.get("sessionId")) == sid, "Session identity mismatch")
                if kind == "session":
                    session_count += 1
                    require(session_count == 1, "Duplicate session header")
                else:
                    require(session_count == 1, "Session header must precede rows")
            elif path == "resources.jsonl":
                require(kind == "resource" and set(record) == {"type", "resourceId", "path", "mimeType", "contentType", "size"}, "Invalid resource record")
                resource = record["path"]
                require(isinstance(resource, str) and RESOURCE.fullmatch(resource) and resource in lengths and resource not in resources, "Missing/duplicate resource")
                require(type(record["size"]) is int and record["size"] == lengths[resource], "Resource size mismatch")
                require(isinstance(record["resourceId"], str) and 0 < len(record["resourceId"]) <= 4096 and record["resourceId"] not in resource_ids, "Invalid/duplicate resource identity")
                require(isinstance(record["mimeType"], str) and 0 < len(record["mimeType"]) <= 1024 and isinstance(record["contentType"], str) and record["contentType"] in {"text", "binary"}, "Invalid resource metadata")
                resources.add(resource)
                resource_ids.add(record["resourceId"])
            else:
                require(kind == "warning" and set(record) == {"type", "category", "objectId", "message"} and all(isinstance(record[k], str) for k in ("category", "objectId", "message")), "Invalid warning record")
            counts[kind] += 1
        if sid is not None:
            require(session_count == 1, "Session header missing")
    require(resources == {p for p in lengths if RESOURCE.fullmatch(p)}, "Unindexed resource entry")
    resource_bytes = sum(lengths[p] for p in resources)
    data_bytes = sum(size for path, size in lengths.items() if path not in {"manifest.json", "complete.json"} and path not in resources)
    stats = {"archiveId": manifest["archiveId"], "counts": counts, "resourceBytes": resource_bytes, "dataBytes": data_bytes, "entryCount": len(lengths), "uncompressedBytes": sum(lengths.values()) - lengths["complete.json"]}
    return stats


def validate_snapshot(path):
    require(0 < path.stat().st_size <= MAX, "SQLite snapshot size exceeded")
    with path.open("rb") as file:
        header = file.read(100)
    require(len(header) == 100 and header[:16] == b"SQLite format 3\x00" and header[18:20] == b"\x01\x01", "Snapshot must be standalone SQLite in non-WAL format")
    try:
        with readonly(path) as db:
            check_schema(db)
            stats = entries_statistics(db)
            complete = decode(db.execute("SELECT data FROM archive_entries WHERE path='complete.json'").fetchone()[0])
            require(isinstance(complete, dict) and "archiveId" in complete and not set(complete) - stats.keys(), "Invalid V3 complete")
            for key, value in complete.items():
                if key == "counts":
                    require(isinstance(value, dict) and set(value) == COUNT_KEYS and all(type(v) is int and v >= 0 for v in value.values()), "Invalid counts")
                elif key != "archiveId":
                    require(type(value) is int and value >= 0, "Invalid complete statistic")
                require(value == stats[key], "V3 completion statistics mismatch: " + key)
    except sqlite3.Error as error:
        raise ValueError("Invalid or unsafe SQLite database") from error
    return stats