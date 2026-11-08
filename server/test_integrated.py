import tempfile
import unittest
from unittest.mock import patch
from app import create_app


class IntegratedTests(unittest.TestCase):
    def test_exact_proxy_origin_and_same_origin_requests(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'CHATBOX_INTEGRATED_ORIGIN': 'http://127.0.0.1:1212'}):
            app = create_app(data_dir=directory, trusted_proxy_peers=set(), allowed_hosts=set())
            client = app.test_client()
            headers = {'Host': '127.0.0.1:1212', 'X-Forwarded-Proto': 'http', 'Origin': 'http://127.0.0.1:1212'}
            self.assertEqual(client.get('/admin/login', headers=headers).status_code, 200)
            self.assertEqual(client.get('/admin/login', headers={'Host': '127.0.0.1:1212'}).status_code, 403)
            self.assertEqual(client.get('/admin/login', headers={**headers, 'Host': 'evil.example'}).status_code, 403)
            self.assertEqual(client.get('/admin/login', headers=headers, environ_overrides={'REMOTE_ADDR': '192.168.1.2'}).status_code, 403)
            self.assertEqual(client.get('/admin/login', headers={**headers, 'Origin': 'https://evil.example'}).status_code, 403)

    def test_remote_requires_https_and_secure_cookie(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict('os.environ', {'CHATBOX_INTEGRATED_ORIGIN': 'http://sync.example'}), self.assertRaises(ValueError):
                create_app(data_dir=directory, trusted_proxy_peers=set(), allowed_hosts=set())
            with patch.dict('os.environ', {'CHATBOX_INTEGRATED_ORIGIN': 'https://sync.example'}):
                app = create_app(data_dir=directory, trusted_proxy_peers=set(), allowed_hosts=set())
            response = app.test_client().get('/admin/login', headers={'Host': 'sync.example', 'X-Forwarded-Proto': 'https'})
            self.assertEqual(response.status_code, 200)
            self.assertIn('Secure', response.headers['Set-Cookie'])