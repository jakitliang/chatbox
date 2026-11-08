import base64
import unittest

from snapshot_avatars import MAX_AVATAR_BYTES, assistant_avatar, data_image, raster


class AvatarTests(unittest.TestCase):
    def test_inline_raster_and_reject_active_content(self):
        content = b"\x89PNG\r\n\x1a\nsynthetic"
        url = "data:image/png;base64," + base64.b64encode(content).decode()
        self.assertEqual(data_image(url), (content, "image/png"))
        self.assertEqual(assistant_avatar(None, {"avatar": {"type": "url", "url": url}}, {}), (content, "image/png"))
        self.assertEqual(assistant_avatar(None, {"picUrl": url}, {}), (content, "image/png"))
        for value in ["https://example.com/avatar.png", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "data:image/png;base64,!!!", "data:image/png,plain"]:
            self.assertIsNone(data_image(value))
        self.assertIsNone(assistant_avatar(None, {"avatar": {"type": "url", "url": "https://example.com/private"}}, {}))
        self.assertIsNone(assistant_avatar(None, {"avatar": {"type": "storage-key", "storageKey": "missing"}}, {}))
        self.assertIsNone(assistant_avatar(None, {"avatar": {"type": "storage-key", "storageKey": "big"}}, {"big": {"size": MAX_AVATAR_BYTES + 1}}))
        self.assertEqual(raster(b"RIFF0000WEBPdata"), "image/webp")
        self.assertEqual(raster(b"\xff\xd8\xffdata"), "image/jpeg")
        self.assertEqual(raster(b"GIF89adata"), "image/gif")