"""CRM navigation and server-side filtering; synthetic snapshots only."""

import base64
import re
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from app import create_app
from snapshot_validation import encode, entries_statistics
from test_sync import PASSWORD, fixture


class AdminUiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = create_app(Path(self.temp.name), trusted_proxy_peers=set(), allowed_hosts=set())
        self.app.config["TESTING"] = True
        self.store = self.app.extensions["sync_store"]
        self.store.provision("alice", PASSWORD)
        self.client = self.app.test_client()
        response = self.client.get("/admin/login")
        csrf = re.search(rb'name="csrf_token" value="([^"]+)"', response.data).group(1).decode()
        self.client.post("/admin/login", data={"csrf_token": csrf, "username": "alice", "password": PASSWORD})

    def publish(self):
        path = self.store.snapshot("alice")
        fixture(path)
        items = [{"id": f"id-{i}", "name": f"Helper {i:02}", "prompt": "Synthetic prompt", "category": " Work " if i < 23 else "", "description": "sample"} for i in range(25)]
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("UPDATE archive_entries SET data=? WHERE path='copilots.json'", (encode(items),))
            db.execute("UPDATE archive_entries SET data=? WHERE path='complete.json'", (encode(entries_statistics(db)),))

    def get(self, query=""):
        response = self.client.get("/admin/users/alice" + query)
        self.assertEqual(response.status_code, 200, response.data)
        return response.get_data(as_text=True)

    def test_empty_and_all_sections(self):
        self.assertIn("你的存档空间已准备好", self.get())
        self.publish()
        for tab in ["overview", "assistants", "categories", "settings"]:
            html = self.get("?tab=" + tab)
            self.assertIn('aria-current="page"', html)
            self.assertIn("后台导航", html)
        self.assertIn("存档信息", self.get("?tab=overview"))
        settings = self.get("?tab=settings")
        self.assertIn("界面与语言", settings)
        self.assertIn('name="settings_form"', settings)
        self.assertNotIn('name="settings"', settings)
        self.assertNotIn("private-key", settings)
        self.assertNotIn("private-key", self.get())

    def test_search_category_and_pagination(self):
        self.publish()
        first = self.get()
        self.assertIn("Helper 19", first)
        self.assertNotIn("Helper 20", first)
        self.assertIn("Helper 20", self.get("?page=2"))
        self.assertIn("Helper 24", self.get("?page=999"))
        search = self.get("?q=Helper+24")
        self.assertIn("Helper 24", search)
        self.assertNotIn("Helper 23", search)
        self.assertIn("23 条结果", self.get("?category=Work"))
        self.assertIn("2 条结果", self.get("?category=__uncategorized__"))
        self.assertIn("没有符合筛选条件", self.get("?q=missing"))
        self.assertIn("1 / 2", self.get("?page=invalid"))

    def test_selected_editor_and_escaping(self):
        self.publish()
        html = self.get("?edit=id-24")
        self.assertIn('name="original_id" value="id-24"', html)
        self.assertIn('name="revision"', html)
        self.assertIn("删除此助手", html)
        self.assertNotIn("删除此助手", self.get())
        self.assertIn("&lt;script&gt;", self.get("?q=%3Cscript%3E"))

    def test_private_snapshot_avatar(self):
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1sAAAAASUVORK5CYII=")
        path = self.store.snapshot("alice")
        fixture(path, resource=png)
        with closing(sqlite3.connect(path)) as db, db:
            record = {"type": "resource", "resourceId": "picture:one", "path": "resources/000000.bin", "mimeType": "image/png", "contentType": "binary", "size": len(png)}
            db.execute("UPDATE archive_entries SET data=? WHERE path='resources.jsonl'", (encode(record) + b"\n",))
        self.assertIn('class="avatar avatar-image"', self.get())
        route = "/admin/users/alice/assistant-avatar?id=assistant"
        response = self.client.get(route)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, png)
        self.assertEqual(response.mimetype, "image/png")
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertIn("img-src 'self'", response.headers["Content-Security-Policy"])
        self.assertEqual(self.client.get(route.replace("alice", "bob")).status_code, 404)
        self.assertEqual(self.app.test_client().get(route).status_code, 303)
        self.assertEqual(self.client.get("/admin/users/alice/assistant-avatar?id=missing").status_code, 404)


if __name__ == "__main__":
    unittest.main()