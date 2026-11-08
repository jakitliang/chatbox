import tempfile
import unittest
from unittest.mock import patch
from server.sync_service import create_app


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.app = create_app(self.directory.name, trusted_proxy_peers=set(), allowed_hosts=set())
        self.client = self.app.test_client()

    def form(self, username="newuser", password="long-test-password", confirmation=None):
        self.client.get("/admin/register")
        with self.client.session_transaction(path="/admin/register") as session:
            token = session["csrf"]
        return {"csrf_token": token, "username": username, "password": password,
                "confirmation": password if confirmation is None else confirmation}

    def test_registration_and_duplicate_cannot_reset_password(self):
        data = self.form()
        self.assertEqual(self.client.post("/admin/register", data=data).status_code, 303)
        duplicate = self.form(password="different-test-password")
        self.assertEqual(self.client.post("/admin/register", data=duplicate).status_code, 400)
        store = self.app.extensions["sync_store"]
        self.assertEqual(store.login("newuser", "long-test-password", "test")[1], 200)
        self.assertEqual(store.login("newuser", "different-test-password", "test")[1], 401)
        self.assertFalse(store.snapshot("newuser").exists())

    def test_csrf_confirmation_validation_and_rate_limit(self):
        self.assertEqual(self.client.post("/admin/register", data={}).status_code, 403)
        self.assertEqual(self.client.post("/admin/register", data=self.form(confirmation="mismatch")).status_code, 400)
        for _ in range(5):
            self.assertEqual(self.client.post("/admin/register", data=self.form(username="../unsafe")).status_code, 400)
        self.assertEqual(self.client.post("/admin/register", data=self.form()).status_code, 429)

    def test_disabled_registration(self):
        with patch.dict("os.environ", {"CHATBOX_SYNC_REGISTRATION": "0"}):
            app = create_app(self.directory.name, trusted_proxy_peers=set(), allowed_hosts=set())
        client = app.test_client()
        self.assertEqual(client.get("/admin/register").status_code, 403)
        self.assertNotIn(b"Create an account", client.get("/admin/login").data)