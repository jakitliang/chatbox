"""Explicit public API snapshot; never called by the running Flask service.

Downloaded content stays local/ignored. Public availability is not a license
to redistribute it; retain source records and review rights before publishing.
"""

import argparse
import base64
import copy
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

try:
    from .storage import DEFAULTS, MAX_AVATAR_BYTES, Storage, avatar_type, validate_config
    from .import_data import import_owned
except ImportError:
    from storage import DEFAULTS, MAX_AVATAR_BYTES, Storage, avatar_type, validate_config
    from import_data import import_owned

ORIGIN = "https://api.chatboxai.app"
AGENT = "ChatboxSelfHostSnapshot/1.0"
PROVIDERS = ("openai", "openai-responses", "claude", "gemini", "deepseek", "qwen", "siliconflow", "groq", "mistral-ai", "moonshot", "minimax", "xAI", "openrouter", "ollama", "lm-studio")


def approved_url(url):
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.fragment:
        raise ValueError("Only uncredentialed HTTPS URLs are allowed")
    if host != "chatboxai.app" and not host.endswith(".chatboxai.app"):
        raise ValueError("Asset is outside the official domain; not followed")
    return url


class Fetcher:
    def __init__(self):
        self.sources = []
        self.robots = {}

    def raw(self, url, body=None, maximum=8 * 1024 * 1024, robots=False):
        approved_url(url)
        command = ["curl", "-4", "--silent", "--show-error", "--proto", "=https", "--connect-timeout", "5", "--max-time", "20", "--max-filesize", str(maximum), "--user-agent", AGENT, "--write-out", "\n%{http_code}", url]
        if body is not None:
            command += ["--header", "Content-Type: application/json", "--data-binary", json.dumps(body)]
        # No cookies, Authorization, device IDs, proxies configured here or redirects.
        for attempt in range(2):
            response = subprocess.run(command, capture_output=True, timeout=25)
            if response.returncode:
                if attempt == 0:
                    continue
                raise ValueError("Network timeout/download failure")
            content, _, code = response.stdout.rpartition(b"\n")
            status = int(code)
            if status >= 500 and attempt == 0:
                continue
            if robots and status == 404:
                self.sources.append({"url": url, "status": 404})
                return b"User-agent: *\nAllow: /\n"
            if status != 200:
                raise ValueError(f"HTTP {status}; no authorization/redirect bypass")
            if len(content) > maximum:
                raise ValueError("Download exceeds size limit")
            self.sources.append({"url": url, "method": "POST" if body is not None else "GET", "body": body, "sha256": hashlib.sha256(content).hexdigest()})
            return content
        raise ValueError("Download failed")

    def fetch(self, url, body=None, maximum=8 * 1024 * 1024):
        approved_url(url)
        parsed = urlsplit(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in self.robots:
            rules = RobotFileParser(origin + "/robots.txt")
            rules.parse(self.raw(origin + "/robots.txt", robots=True).decode().splitlines())
            self.robots[origin] = rules
        if not self.robots[origin].can_fetch(AGENT, url):
            raise ValueError("robots.txt disallows this URL")
        return self.raw(url, body, maximum)

    def api(self, path, body=None):
        return json.loads(self.fetch(ORIGIN + path, body))


def normalized_assistant(item, lang):
    # Language suffix preserves separate localized entries with shared upstream IDs.
    return {"id": str(item["id"]) + ":" + lang, "name": item["name"], "prompt": item.get("prompt", ""), "description": item.get("description") or "", "tags": item.get("tags") or [], "lang": lang, "enabled": True}


def crawl(destination, languages, providers=PROVIDERS, max_pages=30):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    assets = destination / "avatars"
    assets.mkdir(exist_ok=True)
    fetcher = Fetcher()
    previous_sources = destination / "sources.json"
    if previous_sources.is_file():
        fetcher.sources = json.loads(previous_sources.read_text(encoding="utf-8")).get("sources", [])
    assistants, warnings, downloaded = [], [], {}
    previous = destination / "assistants.json"
    cached = {item["id"]: item for item in json.loads(previous.read_text(encoding="utf-8"))} if previous.is_file() else {}
    complete = True
    for lang in languages:
        cursor, cursors, seen = None, set(), set()
        for page in range(max_pages):
            try:
                body = {"lang": lang, "limit": 100}
                if cursor:
                    body["cursor"] = cursor
                response = fetcher.api("/api/system_copilots/list", body)
                items = response["data"]
                if not isinstance(items, list):
                    raise ValueError("Unexpected assistant response")
            except (ValueError, KeyError, subprocess.TimeoutExpired) as error:
                warnings.append(f"{lang}: {error}")
                complete = False
                break
            for item in items:
                value = normalized_assistant(item, lang)
                if value["id"] in seen:
                    continue
                seen.add(value["id"])
                avatar = item.get("avatar")
                url = item.get("picUrl") or (avatar.get("url") if isinstance(avatar, dict) and avatar.get("type") == "url" else None)
                if url:
                    value["upstream_avatar_url"] = url
                    try:
                        if url.startswith("/"):
                            url = ORIGIN + url
                        old_name = cached.get(value["id"], {}).get("avatar_filename")
                        if old_name and Path(old_name).name == old_name and (assets / old_name).is_file():
                            downloaded[url] = old_name
                        if url not in downloaded:
                            content = fetcher.fetch(url, maximum=MAX_AVATAR_BYTES)
                            extension = avatar_type(urlsplit(url).path, content)
                            name = hashlib.sha256(content).hexdigest() + "." + extension
                            (assets / name).write_bytes(content)
                            downloaded[url] = name
                        value["avatar_filename"] = downloaded[url]
                    except (ValueError, subprocess.TimeoutExpired) as error:
                        warnings.append(f"avatar {value['id']}: {error}")
                assistants.append(value)
            print(f"{lang}: page {page + 1}, {len(seen)} assistants", flush=True)
            cursor = response.get("next_cursor")
            if not cursor:
                break
            if not isinstance(cursor, str) or cursor in cursors:
                complete = False
                warnings.append(f"{lang}: invalid/repeated cursor")
                break
            cursors.add(cursor)
        else:
            complete = False
            warnings.append(f"{lang}: page limit reached")
    cached.update({item["id"]: item for item in assistants})
    assistants = list(cached.values())
    configs = copy.deepcopy(DEFAULTS)
    previous_configs = destination / "configs.json"
    if previous_configs.is_file():
        configs["models"] = json.loads(previous_configs.read_text(encoding="utf-8"))["models"]
    catalog_path = destination / "browser-catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8")) if catalog_path.is_file() else {"models": []}
    model_records = {record["provider"]: record for record in catalog["models"]}
    for provider in providers:
        if provider not in PROVIDERS:
            raise ValueError("Provider not allowed (commercial Chatbox AI excluded)")
        try:
            response = fetcher.api("/api/model_manifest", {"aiProvider": provider, "language": "en"})
            manifest = response["data"]
            value = {"groupName": manifest.get("groupName") or provider, "models": manifest.get("models") or [], "imageModels": manifest.get("imageModels") or []}
            validate_config("models", {provider: value})
            model_records[provider] = {"provider": provider, "status": 200, "data": response}
            if value["models"] or value["imageModels"]:
                configs["models"][provider] = value
            print(f"{provider}: {len(value['models'])} models, {len(value['imageModels'])} image models", flush=True)
        except (ValueError, KeyError, AttributeError, subprocess.TimeoutExpired) as error:
            warnings.append(f"models {provider}: {error}")
    catalog["models"] = list(model_records.values())
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # Do NOT inherit paid feature flags, update version, product IDs, AI endpoints.
    for name, value in [("assistants.json", assistants), ("configs.json", configs), ("sources.json", {"fetched_at": datetime.now(timezone.utc).isoformat(), "complete_assistant_pagination": complete, "sources": fetcher.sources, "warnings": warnings, "notice": "Public API snapshot for local use; no redistribution license inferred. Upstream content rights remain with their owners. No AI training use."})]:
        (destination / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(assistants)} assistants / {len(downloaded)} asset URLs; {len(warnings)} warnings", flush=True)
    for warning in warnings:
        print("WARNING:", warning, flush=True)
    return len(assistants)


def seed_empty(storage, directory):
    """Offline, non-destructive defaults: only initialize a wholly empty database."""
    directory = Path(directory)
    if not (directory / "assistants.json").is_file() or not (directory / "configs.json").is_file():
        return False
    if storage.all() or any(storage.config(name) != value for name, value in DEFAULTS.items()):
        return False
    configs = json.loads((directory / "configs.json").read_text(encoding="utf-8"))
    if set(configs) != set(DEFAULTS) or configs["remote"] != DEFAULTS["remote"] or configs["rag"] != DEFAULTS["rag"]:
        raise ValueError("Snapshot cannot enable commercial/remote features")
    if set(configs["models"]) - set(PROVIDERS):
        raise ValueError("Snapshot contains a disallowed provider")
    for name, value in configs.items():
        validate_config(name, value)
    import_owned(storage, directory / "assistants.json", directory / "avatars")
    for name, value in configs.items():
        storage.set_config(name, value)
    return True


def repair_browser_assets(storage, directory, records):
    """Import explicit browser downloads, filling missing icons without changing text."""
    directory = Path(directory)
    assets = directory / "avatars"
    assets.mkdir(parents=True, exist_ok=True)
    assistants = json.loads((directory / "assistants.json").read_text(encoding="utf-8"))
    indexed = {item["id"]: item for item in assistants}
    sources_file = directory / "sources.json"
    sources = json.loads(sources_file.read_text(encoding="utf-8")) if sources_file.is_file() else {"sources": []}
    count = 0
    for record in records:
        url = approved_url(record["source"])
        content = base64.b64decode(record["base64"], validate=True)
        extension = avatar_type(record.get("filename") or urlsplit(url).path, content)
        digest = hashlib.sha256(content).hexdigest()
        name = digest + "." + extension
        value = storage.get(record["id"])
        if value is None or value["avatar_filename"]:
            continue
        uploaded = storage.upload(name, content)
        try:
            value["avatar_filename"] = uploaded
            storage.save(value, value["id"])
        except BaseException:
            storage.remove_unreferenced(uploaded)
            raise
        (assets / name).write_bytes(content)
        if value["id"] in indexed:
            indexed[value["id"]].update(avatar_filename=name, upstream_avatar_url=url)
        sources.setdefault("sources", []).append({"url": url, "method": "GET", "transport": "browser", "sha256": digest, "source_sha256": record.get("source_sha256", digest), "derived": record.get("derived"), "fetched_at": datetime.now(timezone.utc).isoformat()})
        count += 1
    (directory / "assistants.json").write_text(json.dumps(assistants, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (directory / "sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return count


def import_browser_catalog(storage, directory, document):
    """Append public catalogs without replacing user edits or commercial flags."""
    directory = Path(directory)
    snapshot_path = directory / "assistants.json"
    assistants = json.loads(snapshot_path.read_text(encoding="utf-8"))
    indexed = {item["id"]: item for item in assistants}
    result = document["assistants"]
    if result["status"] != 200 or result["data"].get("next_cursor"):
        raise ValueError("Browser catalog is unsuccessful or incomplete")
    new = []
    for item in result["data"]["data"]:
        value = normalized_assistant(item, result["lang"])
        avatar = item.get("avatar") or {}
        url = avatar.get("url") if avatar.get("type") == "url" else item.get("picUrl")
        if url:
            value["upstream_avatar_url"] = approved_url(url)
        indexed.setdefault(value["id"], value)
        if storage.get(value["id"]) is None:
            new.append({**value, "avatar_filename": None})
    configs_path = directory / "configs.json"
    configs = json.loads(configs_path.read_text(encoding="utf-8"))
    models = storage.config("models")
    fetched = {}
    for record in document["models"]:
        provider = record["provider"]
        if provider not in PROVIDERS or record["status"] != 200:
            raise ValueError("Disallowed/unsuccessful model manifest")
        manifest = record["data"]["data"]
        value = {"groupName": manifest.get("groupName") or provider, "models": manifest.get("models") or [], "imageModels": manifest.get("imageModels") or []}
        validate_config("models", {provider: value})
        if value["models"] or value["imageModels"]:
            fetched[provider] = value
            models.setdefault(provider, value)
            configs["models"].setdefault(provider, value)
    storage.import_batch(new)
    storage.set_config("models", models)
    snapshot_path.write_text(json.dumps(list(indexed.values()), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    configs_path.write_text(json.dumps(configs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # Persist full public responses for provenance and future offline comparison.
    (directory / "browser-catalog.json").write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"new_assistants": len(new), "nonempty_model_groups": list(fetched)}


def browser_result(path):
    text = Path(path).read_text(encoding="utf-8")
    if text.startswith("Result: "):
        text = text[len("Result: "):]
    return json.JSONDecoder().raw_decode(text.lstrip())[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", default=str(Path(__file__).parent / "snapshot"))
    parser.add_argument("--languages", nargs="+", default=["zh-Hans", "en"])
    parser.add_argument("--providers", nargs="*", default=list(PROVIDERS))
    parser.add_argument("--apply", action="store_true", help="Seed the empty local database after download")
    parser.add_argument("--browser-assets", help="Import JSON browser downloads to repair missing avatars only")
    parser.add_argument("--browser-catalog", help="Append browser public assistant/model responses, preserving existing data")
    args = parser.parse_args()
    if args.browser_catalog:
        print(import_browser_catalog(Storage(Path(__file__).parent / "data"), args.destination, browser_result(args.browser_catalog)))
        return
    if args.browser_assets:
        records = browser_result(args.browser_assets)
        print("Repaired avatars:", repair_browser_assets(Storage(Path(__file__).parent / "data"), args.destination, records))
        return
    crawl(args.destination, args.languages, args.providers)
    if args.apply:
        storage = Storage(Path(__file__).parent / "data")
        print("Seeded empty local database" if seed_empty(storage, args.destination) else "Existing data retained; no overwrite")


if __name__ == "__main__":
    main()