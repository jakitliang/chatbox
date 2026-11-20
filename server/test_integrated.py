import tempfile
import unittest
from unittest.mock import patch
from app import create_app


class IntegratedTests(unittest.TestCase):
    def test_search_relay_allows_only_public_routes_without_forwarding_credentials(self):
        origin = "http://127.0.0.1:1212"
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            "os.environ", {"CHATBOX_INTEGRATED_ORIGIN": origin}
        ), patch("web_search_relay.build_opener") as build_opener:
            upstream = build_opener.return_value.open
            upstream.return_value.__enter__.return_value.read.return_value = b"<html>search result</html>"
            app = create_app(data_dir=directory, trusted_proxy_peers=set(), allowed_hosts=set())
            client = app.test_client()
            headers = {"Host": "127.0.0.1:1212", "X-Forwarded-Proto": "http",
                       "Origin": origin, "X-Chatbox-Search": "1", "Authorization": "Bearer do-not-forward"}
            path = "/web-search-relay/search-page"
            for url, details, status in (
                (path + "?q=hello", {"Origin": "https://other.invalid"}, 403),
                (path + "?q=hello", {"X-Chatbox-Search": "0"}, 403),
                (path + "?q=hello", {"Sec-Fetch-Site": "cross-site"}, 403),
                (path + "?q=hello&url=https://other.invalid", {}, 400),
                ("/web-search-relay/unknown?q=hello", {}, 404),
            ):
                response = client.get(url, headers={**headers, **details})
                self.assertEqual(response.status_code, status)
                self.assertNotIn("Access-Control-Allow-Origin", response.headers)
            self.assertEqual(client.options(path, headers=headers).status_code, 403)
            upstream.assert_not_called()
            response = client.get(path + "?q=hello+world", headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data, b"<html>search result</html>")
            self.assertEqual(response.mimetype, "text/plain")
            forwarded = upstream.call_args.args[0]
            self.assertEqual(forwarded.full_url, "https://www.bing.com/search?q=hello+world")
            self.assertNotIn("Authorization", forwarded.headers)

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