"""python3 -m unittest discover -s server -v；Flask 缺失时仍运行存储与导入测试。"""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

try:
    from .storage import MAX_AVATAR_BYTES, Storage, avatar_type
    from .import_data import import_owned, relative_avatar
except ImportError:
    from storage import MAX_AVATAR_BYTES, Storage, avatar_type
    from import_data import import_owned, relative_avatar

# 完整的 1×1 PNG，测试资源是人工定义的，不来源于旧仓库内容。
import base64
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=")


def assistant(assistant_id="one", **changes):
    value = dict(id=assistant_id, name="测试助手", description="本地说明", prompt="用户自己的提示词", tags=["写作"], lang="zh-Hans", avatar_filename=None, enabled=True)
    value.update(changes)
    return value


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.storage = Storage(Path(self.temp.name) / "data")

    def test_crud_and_persistence(self):
        self.storage.save(assistant())
        second = Storage(self.storage.directory)
        self.assertEqual(second.get("one")["prompt"], "用户自己的提示词")
        self.assertEqual(second.secret(), self.storage.secret())
        second.save(assistant("renamed", enabled=False), "one")
        self.assertIsNone(self.storage.get("one"))
        self.assertEqual(self.storage.all(True), [])
        second.delete("renamed")
        self.assertEqual(self.storage.all(), [])

    def test_config_persistence_and_validation(self):
        value = {"local": {"groupName": "本地", "models": [{"modelId": "my-model", "modelName": "自有模型"}], "imageModels": []}}
        self.storage.set_config("models", value)
        self.assertEqual(Storage(self.storage.directory).config("models"), value)
        for kind, bad in [("models", []), ("rag", {}), ("remote", {"setting_chatboxai_first": "false"}), ("unknown", {})]:
            with self.assertRaises(ValueError):
                self.storage.set_config(kind, bad)

    def test_duplicate_id_and_sql_parameters(self):
        self.storage.save(assistant(name="'; DROP TABLE assistants; --"))
        with self.assertRaises(sqlite3.IntegrityError):
            self.storage.save(assistant())
        self.assertEqual(len(self.storage.all()), 1)
        for unsafe in ["../unsafe", ".", ".."]:
            with self.assertRaises(ValueError):
                self.storage.save(assistant(unsafe))

    def test_avatar_magic_size_and_uuid(self):
        name = self.storage.upload("../../original.PNG", PNG)
        self.assertRegex(name, r"^[a-f0-9]{32}\.png$")
        self.assertEqual(self.storage.avatar_path(name).read_bytes(), PNG)
        for filename, content in [("a.svg", b"<svg/>"), ("a.png", b"GIF89a"), ("a.jpg", PNG), ("a.png", b""), ("a.png", PNG + b"x" * MAX_AVATAR_BYTES)]:
            with self.assertRaises(ValueError):
                self.storage.upload(filename, content)
        for filename, content, extension in [("a.jpeg", b"\xff\xd8\xffabc", "jpg"), ("a.gif", b"GIF89aabc", "gif"), ("a.webp", b"RIFF0000WEBPabc", "webp")]:
            self.assertEqual(avatar_type(filename, content), extension)

    def test_traversal_and_symlink(self):
        for name in ["../chatbox.sqlite3", "/etc/passwd", "a.png", "..%2fsecret"]:
            self.assertIsNone(self.storage.avatar_path(name))
        link = self.storage.uploads / ("a" * 32 + ".png")
        link.symlink_to(self.storage.database)
        self.assertIsNone(self.storage.avatar_path(link.name))
        self.storage.collect_orphans()
        self.assertTrue(self.storage.database.is_file())

    def test_reference_removal_and_orphan_gc(self):
        name = self.storage.upload("a.png", PNG)
        self.storage.save(assistant(avatar_filename=name))
        self.storage.save(assistant("two", avatar_filename=name))
        self.storage.delete("one")
        self.assertIsNotNone(self.storage.avatar_path(name))
        self.storage.save(assistant("two"), "two")
        self.assertIsNone(self.storage.avatar_path(name))
        orphan = self.storage.upload("a.png", PNG)
        self.storage.collect_orphans()
        self.assertIsNone(self.storage.avatar_path(orphan))

    def test_batch_transaction_rollback(self):
        self.storage.save(assistant())
        with self.assertRaises(sqlite3.IntegrityError):
            self.storage.import_batch([assistant("two"), assistant()])
        self.assertIsNone(self.storage.get("two"))

    def test_offline_import_and_rollback(self):
        root = Path(self.temp.name) / "original"
        root.mkdir()
        (root / "mine.png").write_bytes(PNG)
        source = root / "mine.json"
        source.write_text(json.dumps({"data": [dict(assistant(), picUrl="/api/avatar/mine.png")]}))
        self.assertEqual(import_owned(self.storage, source, root), 1)
        self.assertTrue(self.storage.get("one")["avatar_filename"])
        before = list(self.storage.uploads.iterdir())
        with self.assertRaises(sqlite3.IntegrityError):
            import_owned(self.storage, source, root)
        self.assertEqual(list(self.storage.uploads.iterdir()), before)

    def test_import_paths_reject_traversal_remote_and_symlinks(self):
        root = Path(self.temp.name)
        (root / "mine.png").write_bytes(PNG)
        (root / "link.png").symlink_to(root / "mine.png")
        for path in ["../mine.png", "/etc/passwd", "https://example.com/a.png", "//example.com/a.png", "mine.png?x=1", "a\\mine.png", "%2e%2e/mine.png", "link.png"]:
            with self.assertRaises(ValueError):
                relative_avatar(root, path)


if __name__ == "__main__":
    unittest.main()