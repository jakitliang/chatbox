import tempfile
import unittest
from unittest.mock import patch
from sync_service import create_app


class DevCorsTests(unittest.TestCase):
    def test_dev_cors_is_loopback_only_and_does_not_bypass_auth(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {"CHATBOX_SYNC_DEV_CORS": "1"}):
            client = create_app(directory, allowed_hosts=set(), trusted_proxy_peers=set()).test_client()
            headers = {"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
                       "Access-Control-Request-Headers": "authorization,content-type,x-chunk-sha256",
                       "Access-Control-Request-Private-Network": "true"}
            response = client.options("/api/sync/login", headers=headers)
            self.assertEqual(response.status_code, 204)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], headers["Origin"])
            self.assertEqual(response.headers["Access-Control-Allow-Private-Network"], "true")
            self.assertEqual(client.get("/api/sync/snapshot", headers={"Origin": headers["Origin"]}).status_code, 401)
            headers["Origin"] = "https://untrusted.example"
            self.assertEqual(client.options("/api/sync/login", headers=headers).status_code, 403)

    def test_production_rejects_unconfigured_dev_ports(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {"CHATBOX_SYNC_DEV_CORS": "0"}):
            client = create_app(directory, allowed_hosts=set(), trusted_proxy_peers=set()).test_client()
            self.assertEqual(client.options("/api/sync/login", headers={"Origin": "http://localhost:5173"}).status_code, 403)