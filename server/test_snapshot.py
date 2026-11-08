"""Offline tests: no public API requests or external assets needed."""

import json
import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from snapshot import DEFAULTS, Fetcher, approved_url, import_browser_catalog, normalized_assistant, repair_browser_assets, seed_empty
from storage import Storage
from test_app import PNG


class SnapshotTests(unittest.TestCase):
    def test_asset_domains_and_credentials(self):
        self.assertEqual(approved_url("https://assets.chatboxai.app/system/a.png"), "https://assets.chatboxai.app/system/a.png")
        for url in ["http://assets.chatboxai.app/a.png", "https://assets.chatboxai.app.evil.test/a.png", "https://127.0.0.1/a.png", "https://user:pass@assets.chatboxai.app/a.png", "https://assets.chatboxai.app:444/a.png"]:
            with self.assertRaises(ValueError):
                approved_url(url)

    def test_language_ids(self):
        item = {"id": "one", "name": "Assistant", "prompt": "Example", "tags": None}
        self.assertNotEqual(normalized_assistant(item, "en")["id"], normalized_assistant(item, "zh-Hans")["id"])
        self.assertEqual(normalized_assistant(item, "en")["tags"], [])

    def test_offline_seed_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / "snapshot"
            directory.mkdir()
            (directory / "avatars").mkdir()
            (directory / "assistants.json").write_text(json.dumps([normalized_assistant({"id": "one", "name": "Assistant"}, "en")]))
            (directory / "configs.json").write_text(json.dumps(DEFAULTS))
            storage = Storage(Path(temp) / "data")
            with patch.object(Fetcher, "fetch", side_effect=AssertionError("No networking")):
                self.assertTrue(seed_empty(storage, directory))
                self.assertFalse(seed_empty(storage, directory))
            self.assertEqual(len(storage.all()), 1)

    def test_reject_paid_snapshot_flags(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            (directory / "assistants.json").write_text("[]")
            configs = json.loads(json.dumps(DEFAULTS))
            configs["remote"]["setting_chatboxai_first"] = True
            (directory / "configs.json").write_text(json.dumps(configs))
            with self.assertRaises(ValueError):
                seed_empty(Storage(directory / "data"), directory)

    def test_browser_repair_preserves_user_edits_and_existing_avatars(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / "snapshot"
            directory.mkdir()
            item = normalized_assistant({"id": "one", "name": "Original", "prompt": "Original prompt"}, "en")
            (directory / "assistants.json").write_text(json.dumps([item]))
            (directory / "configs.json").write_text(json.dumps(DEFAULTS))
            storage = Storage(Path(temp) / "data")
            seed_empty(storage, directory)
            value = storage.get("one:en")
            value.update(name="User edit", prompt="Keep user prompt", enabled=False)
            storage.save(value, value["id"])
            record = {"id": "one:en", "source": "https://assets.chatboxai.app/system/test.png", "base64": base64.b64encode(PNG).decode()}
            self.assertEqual(repair_browser_assets(storage, directory, [record]), 1)
            repaired = storage.get("one:en")
            self.assertEqual(repaired["name"], "User edit")
            self.assertEqual(repaired["prompt"], "Keep user prompt")
            self.assertFalse(repaired["enabled"])
            self.assertIsNotNone(repaired["avatar_filename"])
            self.assertEqual(repair_browser_assets(storage, directory, [record]), 0)

    def test_browser_catalog_append_preserves_existing_models(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / "snapshot"
            directory.mkdir()
            (directory / "assistants.json").write_text("[]")
            (directory / "configs.json").write_text(json.dumps(DEFAULTS))
            storage = Storage(Path(temp) / "data")
            custom = {"groupName": "User catalog", "models": [], "imageModels": []}
            storage.set_config("models", {"openai": custom})
            document = {"assistants": {"status": 200, "lang": "en", "data": {"data": [{"id": "one", "name": "English assistant"}], "next_cursor": None}}, "models": [{"status": 200, "provider": "openai", "data": {"data": {"groupName": "Public", "models": [{"modelId": "example", "modelName": "Example"}]}}}]}
            self.assertEqual(import_browser_catalog(storage, directory, document)["new_assistants"], 1)
            self.assertEqual(import_browser_catalog(storage, directory, document)["new_assistants"], 0)
            self.assertEqual(storage.config("models")["openai"], custom)
            self.assertEqual(storage.config("remote"), DEFAULTS["remote"])
            self.assertEqual(storage.config("rag"), DEFAULTS["rag"])
            document["models"][0]["provider"] = "chatbox-ai"
            with self.assertRaises(ValueError):
                import_browser_catalog(storage, directory, document)


if __name__ == "__main__":
    unittest.main()