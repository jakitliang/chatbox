"""Synthetic SQLite V3 fixtures; no downloaded/user data in tests."""

import hashlib
import json
import os
import re
import sqlite3
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path

from app import create_app
from sync_store import CHUNK, MAX, SyncStore, valid_username
from snapshot_validation import decode, encode, entries_statistics, session_id, validate_snapshot

PASSWORD = "test-password-12345"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fixture(path, *, resource=b"synthetic private resource", complete_stats=True, table_suffix=""):
    manifest = {"format": "chatbox-backup", "formatVersion": 3, "layout": "rows", "archiveId": "test-archive", "createdAt": "2026-11-08T00:00:00Z", "producer": "test", "selection": {"sessions": True, "settings": True, "copilots": True, "credentials": True}}
    entries = {
        "manifest.json": encode(manifest),
        "settings.json": encode({"language": "en", "apiKey": "private-key", "future": {"retain": True}}),
        "copilots.json": encode([{"id": "assistant", "name": "Assistant", "prompt": "private prompt", "category": "Old", "avatar": {"type": "storage-key", "storageKey": "picture:one"}, "future": {"retain": True}}]),
        "session-settings.json": encode({"agent-memories": [], "session-folders": [], "copilot-memories": {}, "copilot-memory-owners": [], "copilot-memory-state-tokens": []}),
        "sessions/one.jsonl": encode({"type": "session", "session": {"id": "one", "activeThreadId": "root", "type": "chat", "name": "Conversation"}}) + b"\n",
        "resources/000000.bin": resource,
        "resources.jsonl": encode({"type": "resource", "resourceId": "picture:one", "path": "resources/000000.bin", "mimeType": "application/octet-stream", "contentType": "binary", "size": len(resource)}) + b"\n",
        "complete.json": encode({"archiveId": "test-archive"}),
    }
    with closing(sqlite3.connect(path)) as db, db:
        db.executescript(f"PRAGMA user_version=1; CREATE TABLE archive_entries(path TEXT PRIMARY KEY,data BLOB NOT NULL){table_suffix}; CREATE TABLE snapshot_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL){table_suffix};")
        db.executemany("INSERT INTO archive_entries VALUES(?,?)", entries.items())
        db.execute("INSERT INTO snapshot_meta VALUES('opaque','preserve me')")
        if complete_stats:
            db.execute("UPDATE archive_entries SET data=? WHERE path='complete.json'", (encode(entries_statistics(db)),))
    return path.read_bytes()


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = create_app(self.root / "data", trusted_proxy_peers=set(), allowed_hosts=set())
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()
        self.store = self.app.extensions["sync_store"]
        self.store.provision("alice", PASSWORD)
        self.store.provision("bob", PASSWORD)
        self.token = self.login("alice")
        self.other = self.login("bob")
        self.headers = {"Authorization": "Bearer " + self.token}
        self.blob = fixture(self.root / "fixture.db")

    def login(self, username):
        response = self.client.post("/api/sync/login", json={"username": username, "password": PASSWORD})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json), {"token"})
        return response.json["token"]

    def start(self, data=None, checksum=None):
        data = self.blob if data is None else data
        response = self.client.post("/api/sync/uploads", json={"size": len(data), "sha256": checksum or digest(data)}, headers=self.headers)
        self.assertEqual(response.status_code, 201, response.data)
        return response.json["id"]

    def chunks(self, identifier, data=None):
        data = self.blob if data is None else data
        for index, offset in enumerate(range(0, len(data), CHUNK)):
            content = data[offset:offset + CHUNK]
            response = self.client.post(f"/api/sync/uploads/{identifier}/chunks/{index}", data=content, content_type="application/octet-stream", headers={**self.headers, "X-Chunk-SHA256": digest(content)})
            self.assertEqual(response.status_code, 204, response.data)

    def commit(self, identifier, expected=204, headers=None):
        response = self.client.post(f"/api/sync/uploads/{identifier}/commit", headers=headers or self.headers)
        self.assertEqual(response.status_code, expected, response.data)

    def publish(self, data=None):
        identifier = self.start(data)
        self.chunks(identifier, data)
        self.commit(identifier)

    def csrf(self):
        response = self.client.get("/admin/login")
        return re.search(rb'name="csrf_token" value="([^"]+)"', response.data).group(1).decode()

    def admin_login(self):
        response = self.client.post("/admin/login", data={"csrf_token": self.csrf(), "username": "alice", "password": PASSWORD})
        self.assertEqual(response.status_code, 303)

    def form(self, **values):
        response = self.client.get("/admin/users/alice")
        self.assertEqual(response.status_code, 200)
        fields = {key: re.search(('name="' + key + '" value="([^"]+)"').encode(), response.data).group(1).decode() for key in ("csrf_token", "revision")}
        return {**fields, **values}

    def entries(self):
        with closing(sqlite3.connect(self.store.snapshot("alice"))) as db, db:
            return dict(db.execute("SELECT path,data FROM archive_entries"))

    def test_roundtrip_multichunk_exact_contract(self):
        large = fixture(self.root / "large.db", resource=b"x" * (CHUNK + 17))
        self.publish(large)
        response = self.client.get("/api/sync/snapshot", headers=self.headers)
        self.assertEqual(response.json, {"size": len(large), "sha256": digest(large), "chunks": (len(large) + CHUNK - 1) // CHUNK})
        downloaded = []
        for index in range(response.json["chunks"]):
            chunk = self.client.get(f"/api/sync/snapshot/chunks/{index}", headers={**self.headers, "X-Snapshot-SHA256": response.json["sha256"]})
            self.assertEqual(chunk.mimetype, "application/octet-stream")
            self.assertEqual(chunk.headers["X-Chunk-SHA256"], digest(chunk.data))
            downloaded.append(chunk.data)
        self.assertEqual(b"".join(downloaded), large)
        self.assertEqual(self.client.get("/api/sync/snapshot/chunks/256", headers=self.headers).status_code, 404)
        self.assertEqual(list(self.store.staging.iterdir()), [])
        validate_snapshot(self.store.snapshot("alice"))

    def test_all_private_apis_require_bearer_not_admin_cookie(self):
        for route, method in [("/api/sync/uploads", "post"), ("/api/sync/uploads/" + "a" * 32 + "/chunks/0", "post"), ("/api/sync/uploads/" + "a" * 32 + "/commit", "post"), ("/api/sync/snapshot", "get"), ("/api/sync/snapshot/chunks/0", "get"), ("/api/sync/logout", "post"), ("/api/remote_config", "get"), ("/api/avatar/private.png", "get")]:
            self.assertEqual(getattr(self.client, method)(route).status_code, 401)
        self.admin_login()
        self.assertEqual(self.client.get("/api/sync/snapshot").status_code, 401)
        self.assertEqual(self.client.get("/api/remote_config", headers=self.headers).status_code, 404)

    def test_user_isolation_upload_and_download(self):
        identifier = self.start()
        bob = {"Authorization": "Bearer " + self.other}
        self.assertEqual(self.client.post(f"/api/sync/uploads/{identifier}/chunks/0", data=self.blob, content_type="application/octet-stream", headers={**bob, "X-Chunk-SHA256": digest(self.blob)}).status_code, 404)
        self.commit(identifier, 404, bob)
        self.chunks(identifier)
        self.commit(identifier)
        self.assertEqual(self.client.get("/api/sync/snapshot", headers=bob).status_code, 404)
        self.assertEqual(self.client.get("/api/sync/snapshot/chunks/0", headers=bob).status_code, 404)
        self.assertFalse(self.store.snapshot("bob").exists())

    def test_logout_expiry_and_provision_revocation(self):
        self.assertEqual(self.client.post("/api/sync/logout", headers=self.headers).status_code, 204)
        self.assertEqual(self.client.get("/api/sync/snapshot", headers=self.headers).status_code, 401)
        new = self.login("alice")
        with self.store.connect() as db:
            db.execute("UPDATE sessions SET expires=0 WHERE username='alice'")
        self.assertIsNone(self.store.owner(new))
        new = self.login("alice")
        self.store.provision("alice", PASSWORD + "new")
        self.assertIsNone(self.store.owner(new))

    def test_no_defaults_scrypt_and_username_rules(self):
        empty = SyncStore(self.root / "empty")
        self.assertEqual(empty.login("admin", PASSWORD, "127.0.0.1"), (None, 401))
        for username in ["", "../alice", "alice.db", "用户", "Ａlice", "a" * 65, "a\n", "alice/bob"]:
            self.assertFalse(valid_username(username))
            with self.assertRaises(ValueError):
                empty.provision(username, PASSWORD)
        empty.provision("A_z-09", PASSWORD)
        with empty.connect() as db:
            row = db.execute("SELECT salt,hash FROM users").fetchone()
            self.assertEqual((len(row[0]), len(row[1])), (16, 32))
        self.assertNotIn(PASSWORD.encode(), empty.database.read_bytes())
        self.assertNotIn(self.token.encode(), self.store.database.read_bytes())

    def test_login_validation_and_rate_limit(self):
        for value in [[], {"username": "missing", "password": PASSWORD}, {"username": "alice", "password": []}, {"username": "alice", "password": "bad"}]:
            response = self.client.post("/api/sync/login", json=value)
            self.assertIn(response.status_code, {400, 401})
        for _ in range(25):
            response = self.client.post("/api/sync/login", json={"username": "missing", "password": "bad"})
        self.assertEqual(response.status_code, 429)

    def test_upload_size_digest_and_staging_limits(self):
        for size, checksum in [(0, digest(self.blob)), (-1, digest(self.blob)), (MAX + 1, digest(self.blob)), (True, digest(self.blob)), (1.5, digest(self.blob)), (100, "bad"), (100, "A" * 64)]:
            self.assertEqual(self.client.post("/api/sync/uploads", json={"size": size, "sha256": checksum}, headers=self.headers).status_code, 400)
        self.start()
        self.start()
        self.assertEqual(self.client.post("/api/sync/uploads", json={"size": len(self.blob), "sha256": digest(self.blob)}, headers=self.headers).status_code, 429)

    def test_chunk_validation_retry_missing_and_full_hash(self):
        identifier = self.start(checksum="0" * 64)
        route = f"/api/sync/uploads/{identifier}/chunks/0"
        self.assertEqual(self.client.post(route, data=self.blob, headers=self.headers).status_code, 415)
        self.assertEqual(self.client.post(route, data=self.blob, content_type="application/octet-stream", headers={**self.headers, "X-Chunk-SHA256": "0" * 64}).status_code, 400)
        self.commit(identifier, 400)
        self.chunks(identifier)
        self.chunks(identifier)
        changed = b"y" * len(self.blob)
        self.assertEqual(self.client.post(route, data=changed, content_type="application/octet-stream", headers={**self.headers, "X-Chunk-SHA256": digest(changed)}).status_code, 400)
        self.commit(identifier, 400)
        self.assertFalse(self.store.snapshot("alice").exists())

    def test_chunk_out_of_range_and_oversize(self):
        identifier = self.start()
        for index, content in [(1, self.blob), (0, self.blob[:-1])]:
            response = self.client.post(f"/api/sync/uploads/{identifier}/chunks/{index}", data=content, content_type="application/octet-stream", headers={**self.headers, "X-Chunk-SHA256": digest(content)})
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.post(f"/api/sync/uploads/{identifier}/chunks/0", data=b"x" * (CHUNK + 1), content_type="application/octet-stream", headers=self.headers).status_code, 413)

    def test_stored_chunk_tamper_and_expiration_cleanup(self):
        identifier = self.start()
        self.chunks(identifier)
        (self.store.staging / identifier / "0").write_bytes(b"x" * len(self.blob))
        self.commit(identifier, 400)
        with self.store.connect() as db:
            db.execute("UPDATE uploads SET expires=?", (time.time() - 1,))
        self.commit(identifier, 404)
        self.store.cleanup()
        self.assertEqual(list(self.store.staging.iterdir()), [])

    def test_invalid_snapshot_does_not_replace_good(self):
        self.publish()
        before = self.store.snapshot("alice").read_bytes()
        identifier = self.start(b"not SQLite")
        self.chunks(identifier, b"not SQLite")
        self.commit(identifier, 400)
        self.assertEqual(self.store.snapshot("alice").read_bytes(), before)

    def test_schema_and_v3_rejections(self):
        changes = [
            "PRAGMA user_version=2", "CREATE TABLE extra(secret TEXT)",
            "CREATE VIEW steal AS SELECT data FROM archive_entries",
            "CREATE TRIGGER evil AFTER UPDATE ON archive_entries BEGIN DELETE FROM archive_entries; END",
            "CREATE INDEX extra_idx ON snapshot_meta(value)",
            "DELETE FROM archive_entries WHERE path='manifest.json'", "DELETE FROM archive_entries WHERE path='complete.json'",
            "DELETE FROM archive_entries WHERE path='resources.jsonl'", "DELETE FROM archive_entries WHERE path='settings.json'",
            "DELETE FROM archive_entries WHERE path='resources/000000.bin'", "INSERT INTO archive_entries VALUES('../private',x'01')",
            "UPDATE archive_entries SET data=x'ff' WHERE path='settings.json'", "UPDATE archive_entries SET data='text' WHERE path='copilots.json'",
            "UPDATE archive_entries SET data=CAST('{\"archiveId\":\"wrong\"}' AS BLOB) WHERE path='complete.json'",
            "UPDATE archive_entries SET data=CAST('{\"archiveId\":\"test-archive\",\"entryCount\":0}' AS BLOB) WHERE path='complete.json'",
        ]
        for index, change in enumerate(changes):
            with self.subTest(change=change):
                path = self.root / f"bad-{index}.db"
                fixture(path)
                with closing(sqlite3.connect(path)) as db, db:
                    db.execute(change)
                with self.assertRaises(ValueError):
                    validate_snapshot(path)

    def test_optional_complete_and_empty_snapshot(self):
        path = self.root / "optional.db"
        fixture(path, complete_stats=False)
        validate_snapshot(path)
        with closing(sqlite3.connect(path)) as db, db:
            manifest = json.loads(db.execute("SELECT data FROM archive_entries WHERE path='manifest.json'").fetchone()[0])
            manifest["selection"] = dict.fromkeys(manifest["selection"], False)
            db.execute("DELETE FROM archive_entries WHERE path NOT IN ('manifest.json','complete.json','resources.jsonl')")
            db.execute("UPDATE archive_entries SET data=? WHERE path='manifest.json'", (encode(manifest),))
            db.execute("UPDATE archive_entries SET data=x'' WHERE path='resources.jsonl'")
        validate_snapshot(path)

    def test_download_revision_pinning(self):
        self.publish()
        self.assertEqual(self.client.get("/api/sync/snapshot/chunks/0", headers={**self.headers, "X-Snapshot-SHA256": "0" * 64}).status_code, 409)

    def test_admin_requires_login_csrf_same_origin_and_owner(self):
        self.assertEqual(self.client.get("/admin").status_code, 303)
        self.assertEqual(self.client.post("/admin/login", data={"username": "alice", "password": PASSWORD}).status_code, 403)
        self.assertEqual(self.client.get("/admin/login", headers={"Origin": "null"}).status_code, 403)
        self.admin_login()
        self.assertEqual(self.client.get("/admin/users/bob").status_code, 404)
        self.assertEqual(self.client.post("/admin/users/bob/settings", data={"csrf_token": self.csrf()}).status_code, 404)
        self.assertEqual(self.client.get("/admin/users/alice").status_code, 200)
        self.assertEqual(self.client.post("/admin/logout", data={"csrf_token": self.csrf()}, headers={"Origin": "http://localhost:1212"}).status_code, 403)

    def test_admin_edits_preserve_entries_metadata_and_unknown_fields(self):
        self.publish()
        before = self.entries()
        self.admin_login()
        data = self.form(id="assistant", original_id="assistant", name="<script>name</script>", prompt="new prompt", description="desc", category="New")
        self.assertEqual(self.client.post("/admin/users/alice/assistants", data=data).status_code, 303)
        values = self.entries()
        item = json.loads(values["copilots.json"])[0]
        self.assertEqual(item["future"], {"retain": True})
        self.assertEqual(item["avatar"]["storageKey"], "picture:one")
        self.assertEqual(item["category"], "New")
        page = self.client.get("/admin/users/alice").data
        self.assertNotIn(b"<script>", page)
        self.assertIn(b"&lt;script&gt;", page)
        for path in before.keys() - {"copilots.json", "complete.json"}:
            self.assertEqual(before[path], values[path])
        validate_snapshot(self.store.snapshot("alice"))
        self.assertEqual(self.client.post("/admin/users/alice/categories", data=self.form(category="New", replacement="Renamed")).status_code, 303)
        self.assertEqual(json.loads(self.entries()["copilots.json"])[0]["category"], "Renamed")
        self.assertEqual(self.client.post("/admin/users/alice/settings", data=self.form(settings_form="preferences-v1", language="zh-Hans", theme="2", showAvatar="false")).status_code, 303)
        preferences = json.loads(self.entries()["settings.json"])
        self.assertEqual(preferences["language"], "zh-Hans")
        self.assertEqual(preferences["future"], {"retain": True})
        self.assertEqual(preferences["apiKey"], "private-key")
        self.assertEqual(preferences["theme"], 2)
        self.assertIs(preferences["showAvatar"], False)
        with closing(sqlite3.connect(self.store.snapshot("alice"))) as db, db:
            self.assertEqual(db.execute("SELECT value FROM snapshot_meta WHERE key='opaque'").fetchone()[0], "preserve me")
        validate_snapshot(self.store.snapshot("alice"))

    def test_admin_stale_revision_invalid_settings_add_delete_logout(self):
        self.publish()
        self.admin_login()
        before = self.store.snapshot("alice").read_bytes()
        invalid = self.form(settings_form="preferences-v1", fontSize="999")
        self.assertEqual(self.client.post("/admin/users/alice/settings", data=invalid).status_code, 400)
        self.assertEqual(self.store.snapshot("alice").read_bytes(), before)
        data = self.form(settings="[]")
        self.assertEqual(self.client.post("/admin/users/alice/settings", data=data).status_code, 400)
        self.assertEqual(self.client.post("/admin/users/alice/settings", data={**data, "revision": "stale"}).status_code, 409)
        self.assertEqual(self.client.post("/admin/users/alice/assistants", data=self.form(id="new", name="New", prompt="new")).status_code, 303)
        self.assertEqual([item["id"] for item in json.loads(self.entries()["copilots.json"])], ["new", "assistant"])
        self.assertEqual(self.client.post("/admin/users/alice/assistants", data=self.form(id="assistant", original_id="assistant", name="Edited", prompt="edited")).status_code, 303)
        self.assertEqual([item["id"] for item in json.loads(self.entries()["copilots.json"])], ["new", "assistant"])
        self.assertEqual(self.client.post("/admin/users/alice/assistants/delete", data=self.form(id="new")).status_code, 303)
        self.assertEqual(len(json.loads(self.entries()["copilots.json"])), 1)
        self.assertEqual(self.client.post("/admin/logout", data={"csrf_token": self.csrf()}).status_code, 303)
        self.assertEqual(self.client.get("/admin/users/alice").status_code, 303)

    def test_host_peer_origin_and_untrusted_forwarding(self):
        for host in ["evil.example", "localhost.evil", "localhost@evil.example", "192.168.1.2", "localhost/path"]:
            self.assertEqual(self.client.get("/api/sync/snapshot", headers={**self.headers, "Host": host}).status_code, 403)
        self.assertEqual(self.client.get("/api/sync/snapshot", headers={**self.headers, "X-Forwarded-For": "127.0.0.1", "X-Forwarded-Proto": "https"}, environ_overrides={"REMOTE_ADDR": "192.168.1.2"}).status_code, 403)
        self.assertEqual(self.client.get("/api/sync/snapshot", headers={**self.headers, "Origin": "https://evil.example"}).status_code, 403)
        for host in ["localhost:4567", "127.0.0.1:4567", "[::1]:4567"]:
            self.assertEqual(self.client.get("/api/sync/snapshot", headers={**self.headers, "Host": host}).status_code, 404)

    def test_trusted_tls_proxy_and_direct_tls(self):
        with self.assertRaises(ValueError):
            create_app(self.root / "invalid", trusted_proxy_peers={"127.0.0.1"}, allowed_hosts=set())
        app = create_app(self.root / "proxy", trusted_proxy_peers={"127.0.0.1"}, allowed_hosts={"sync.example"}, allowed_origins={"https://client.example"})
        client = app.test_client()
        for proto in [None, "http", "https,http"]:
            headers = {"Host": "sync.example", **({"X-Forwarded-Proto": proto} if proto else {})}
            self.assertEqual(client.get("/admin/login", headers=headers).status_code, 403)
        trusted = {"Host": "sync.example", "X-Forwarded-Proto": "https"}
        response = client.get("/admin/login", headers=trusted)
        self.assertEqual(response.status_code, 200)
        self.assertIn("Secure", response.headers["Set-Cookie"])
        self.assertEqual(client.get("/admin/login", headers={**trusted, "Host": "evil.example"}).status_code, 403)
        self.assertEqual(client.get("/admin/login", headers=trusted, environ_overrides={"REMOTE_ADDR": "192.168.1.2"}).status_code, 403)
        self.assertEqual(client.get("/admin/login", headers={**trusted, "Origin": "https://sync.example"}).status_code, 200)
        direct = create_app(self.root / "direct", trusted_proxy_peers=set(), allowed_hosts={"sync.example"}, allowed_origins={"https://client.example"}).test_client()
        self.assertEqual(direct.get("/admin/login", base_url="https://sync.example", environ_overrides={"REMOTE_ADDR": "192.168.1.2"}).status_code, 200)
        self.assertEqual(direct.get("/admin/login", base_url="http://sync.example", environ_overrides={"REMOTE_ADDR": "192.168.1.2"}, headers={"X-Forwarded-Proto": "https"}).status_code, 403)

    def test_cors_chunk_headers_exposed_and_no_credentials(self):
        self.publish()
        for origin in ["http://localhost:1212", "null"]:
            response = self.client.options("/api/sync/uploads/" + "a" * 32 + "/chunks/0", headers={"Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type, Authorization, X-Chunk-SHA256, X-Snapshot-SHA256"})
            self.assertEqual(response.status_code, 204)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], origin)
            self.assertNotIn("Access-Control-Allow-Credentials", response.headers)
            response = self.client.get("/api/sync/snapshot/chunks/0", headers={**self.headers, "Origin": origin})
            self.assertIn("X-Chunk-SHA256", response.headers["Access-Control-Expose-Headers"])
            self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(self.client.options("/api/sync/uploads", headers={"Origin": "null", "Access-Control-Request-Headers": "X-Unknown"}).status_code, 403)

    def test_private_permissions(self):
        self.publish()
        if os.name == "posix":
            self.assertEqual(self.store.database.stat().st_mode & 0o777, 0o600)
            self.assertEqual(self.store.snapshot("alice").stat().st_mode & 0o777, 0o600)
            self.assertEqual(self.store.directory.stat().st_mode & 0o777, 0o700)

    def test_portable_session_paths_and_nonfinite_json(self):
        for path, identifier in [("sessions/a%2Eb.jsonl", "a.b"), ("sessions/%63on.jsonl", "con"), ("sessions/a%2Fb.jsonl", "a/b"), ("sessions/%E4%BD%A0.jsonl", "你")]:
            self.assertEqual(session_id(path), identifier)
        for path in ["sessions/a.b.jsonl", "sessions/con.jsonl", "sessions/%41.jsonl", "sessions/%FF.jsonl"]:
            with self.assertRaises(ValueError):
                session_id(path)
        for data in [b'{"value":NaN}', b'{"value":1e999}', b'{"duplicate":1,"duplicate":2}']:
            with self.assertRaises(ValueError):
                decode(data)

    def test_out_of_order_chunks_and_snapshot_replacement(self):
        self.publish()
        large = fixture(self.root / "replacement.db", resource=b"r" * (CHUNK + 19))
        identifier = self.start(large)
        count = (len(large) + CHUNK - 1) // CHUNK
        for index in reversed(range(count)):
            content = large[index * CHUNK:(index + 1) * CHUNK]
            response = self.client.post(f"/api/sync/uploads/{identifier}/chunks/{index}", data=content, content_type="application/octet-stream", headers={**self.headers, "X-Chunk-SHA256": digest(content)})
            self.assertEqual(response.status_code, 204)
        self.commit(identifier)
        self.assertEqual(self.store.snapshot("alice").read_bytes(), large)
        self.commit(identifier, 404)

    def test_authentication_persists_across_restart(self):
        restarted = create_app(self.store.directory, trusted_proxy_peers=set(), allowed_hosts=set())
        self.assertEqual(restarted.extensions["sync_store"].owner(self.token), "alice")
        self.assertEqual(restarted.test_client().get("/api/sync/snapshot", headers=self.headers).status_code, 404)

    def test_supported_schema_variants_and_wal_rejection(self):
        for index, suffix in enumerate((" STRICT", " WITHOUT ROWID")):
            path = self.root / f"variant-{index}.db"
            fixture(path, table_suffix=suffix)
            validate_snapshot(path)
        path = self.root / "wal.db"
        fixture(path)
        with closing(sqlite3.connect(path)) as db:
            self.assertEqual(db.execute("PRAGMA journal_mode=WAL").fetchone()[0], "wal")
        with self.assertRaises(ValueError):
            validate_snapshot(path)