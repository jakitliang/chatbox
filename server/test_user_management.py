import hashlib
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import create_app
from sync_store import SyncStore
from test_sync import PASSWORD, fixture


class UserManagementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        with patch.dict("os.environ", {"CHATBOX_ADMIN_PASSWORD": PASSWORD}):
            self.app = create_app(Path(self.temp.name), trusted_proxy_peers=set(), allowed_hosts=set())
        self.store = self.app.extensions["sync_store"]
        self.store.provision("alice", PASSWORD)
        self.client = self.app.test_client()

    def login(self, username):
        response = self.client.get("/admin/login")
        csrf = re.search(rb'name="csrf_token" value="([^"]+)"', response.data).group(1).decode()
        self.assertEqual(self.client.post("/admin/login", data={"csrf_token": csrf, "username": username, "password": PASSWORD}).status_code, 303)
        with self.client.session_transaction(path="/admin") as session:
            return session["csrf"]

    def test_reserved_registration_and_cli(self):
        for name in ["admin", "Admin", "ADMIN"]:
            with self.assertRaises(ValueError):
                self.store.register(name, PASSWORD, name)
        with self.assertRaises(ValueError):
            self.store.provision("admin", PASSWORD)
        self.client.get("/admin/register")
        with self.client.session_transaction(path="/admin") as session:
            csrf = session["csrf"]
        self.assertEqual(self.client.post("/admin/register", data={"csrf_token": csrf, "username": "admin", "password": PASSWORD, "confirmation": PASSWORD}).status_code, 400)

    def test_admin_config_rotation_and_disabled(self):
        token, status = self.store.login("admin", PASSWORD, "test")
        self.assertEqual(status, 200)
        self.store.configure_admin(PASSWORD)
        self.assertEqual(self.store.owner(token), "admin")
        self.store.configure_admin(PASSWORD + "changed")
        self.assertIsNone(self.store.owner(token))
        self.assertEqual(self.store.login("admin", PASSWORD, "test")[1], 401)
        self.store.configure_admin(None)
        self.assertEqual(self.store.login("admin", PASSWORD + "changed", "test")[1], 401)
        disabled = SyncStore(Path(self.temp.name))
        self.assertEqual(disabled.login("admin", PASSWORD + "changed", "test")[1], 401)
        with self.assertRaises(ValueError):
            self.store.configure_admin("short")

    def test_only_admin_and_no_private_data_links(self):
        self.login("alice")
        self.assertEqual(self.client.get("/admin/users").status_code, 403)
        self.assertNotIn("用户管理", self.client.get("/admin/users/alice").get_data(as_text=True))
        self.login("admin")
        html = self.client.get("/admin/users").get_data(as_text=True)
        self.assertIn("alice", html)
        for label in ["数据概览", "助手管理", "分类管理", "应用配置"]:
            self.assertNotIn(label, html)
        self.assertIn("/admin/users", self.client.get("/admin").headers["Location"])
        self.assertEqual(self.client.get("/admin/users/admin").status_code, 404)
        self.assertNotIn("/admin/users/admin/delete", html)
        self.assertNotIn('href="/admin/users/alice', html)
        self.assertEqual(self.client.get("/admin/users/alice").status_code, 404)
        self.assertEqual(self.client.get("/admin/users/alice/assistant-avatar?id=x").status_code, 404)

    def test_admin_cannot_use_client_snapshots(self):
        self.assertEqual(self.client.post("/api/sync/login", json={"username": "admin", "password": PASSWORD}).status_code, 403)
        token = self.store.login("admin", PASSWORD, "test")[0]
        headers = {"Authorization": "Bearer " + token}
        for route, method in [("/api/sync/snapshot", "get"), ("/api/sync/snapshot/chunks/0", "get"), ("/api/sync/uploads", "post")]:
            self.assertEqual(getattr(self.client, method)(route, headers=headers).status_code, 403)
        with self.assertRaises(ValueError):
            self.store.start("admin", 1, "0" * 64)
        self.assertEqual(self.client.post("/api/sync/logout", headers=headers).status_code, 204)

    def test_delete_confirmation_csrf_and_full_cleanup(self):
        fixture(self.store.snapshot("alice"))
        fixture(self.store.snapshot("admin"))
        admin_snapshot = self.store.snapshot("admin").read_bytes()
        token = self.store.login("alice", PASSWORD, "test")[0]
        upload = self.store.start("alice", 1, hashlib.sha256(b"x").hexdigest())
        csrf = self.login("admin")
        route = "/admin/users/alice/delete"
        self.assertEqual(self.client.post(route, data={"confirmation": "alice"}).status_code, 403)
        self.assertEqual(self.client.post(route, data={"csrf_token": csrf, "confirmation": "wrong"}).status_code, 400)
        self.assertEqual(self.client.post("/admin/users/admin/delete", data={"csrf_token": csrf, "confirmation": "admin"}).status_code, 400)
        self.assertEqual(self.client.post(route, data={"csrf_token": csrf, "confirmation": "alice"}).status_code, 303)
        self.assertIsNone(self.store.owner(token))
        self.assertFalse(self.store.snapshot("alice").exists())
        self.assertFalse((self.store.staging / upload).exists())
        self.assertEqual(self.store.list_users(), [])
        self.assertEqual(self.store.snapshot("admin").read_bytes(), admin_snapshot)
        with self.assertRaises(LookupError):
            self.store.start("alice", 1, "0" * 64)
        self.assertEqual(self.client.post(route, data={"csrf_token": csrf, "confirmation": "alice"}).status_code, 404)

    def test_regular_user_cannot_delete_anyone(self):
        csrf = self.login("alice")
        self.assertEqual(self.client.post("/admin/users/alice/delete", data={"csrf_token": csrf, "confirmation": "alice"}).status_code, 403)
        self.assertEqual(len(self.store.list_users()), 1)

    def test_dotenv_loading_without_interpolation(self):
        with patch("sync_service.dotenv_values", return_value={"CHATBOX_ADMIN_PASSWORD": PASSWORD}) as loader, patch("sync_service.os.access", return_value=True), patch("sync_service.default_directory", return_value=Path(self.temp.name)), patch.dict("os.environ", {}, clear=True):
            app = create_app(trusted_proxy_peers=set(), allowed_hosts=set())
            self.assertEqual(app.extensions["sync_store"].login("admin", PASSWORD, "test")[1], 200)
            self.assertFalse(loader.call_args.kwargs["interpolate"])