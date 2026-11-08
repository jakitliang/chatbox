import unittest

from settings_forms import settings_form


class SettingsFormsTests(unittest.TestCase):
    def save(self, existing=None, **fields):
        return settings_form({"settings_form": "preferences-v1", **fields}, existing or {})

    def test_preserve_unknown_fields_and_secrets(self):
        original = {"apiKey": "secret", "providers": {"custom": {"apiKey": "private"}}, "future": [1, {"x": True}], "language": "en"}
        result = self.save(original, language="zh-Hans", theme="0", fontSize="16", showAvatar="false")
        self.assertEqual(result["providers"], original["providers"])
        self.assertEqual(result["future"], original["future"])
        self.assertEqual(result["apiKey"], "secret")
        self.assertEqual(result["theme"], 0)
        self.assertIs(result["showAvatar"], False)
        self.assertTrue(result["languageInited"])
        self.assertEqual(original["language"], "en")

    def test_missing_and_default_fields_remain_unchanged(self):
        self.assertEqual(self.save(fontSize="", showAvatar="__keep__", defaultPrompt=""), {})
        self.assertEqual(self.save({"fontSize": 14}, fontSize=""), {"fontSize": 14})
        self.assertEqual(self.save({"language": "en"}, language="en"), {"language": "en"})

    def test_types_and_bounds(self):
        for field, values in {"theme": ["dark", "3"], "language": ["xx"], "showAvatar": ["on", "1"],
                              "fontSize": ["9", "23", "14.5", "NaN"], "compactionThreshold": ["0.39", "0.91", "inf", "bad"]}.items():
            for value in values:
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    self.save(**{field: value})
        self.assertEqual(self.save(compactionThreshold="0.75")["compactionThreshold"], 0.75)

    def test_text_and_forbidden_updates(self):
        self.assertEqual(self.save(defaultPrompt=" hello \nworld ")["defaultPrompt"], " hello \nworld ")
        self.assertEqual(self.save({"defaultPrompt": "old"}, defaultPrompt="")["defaultPrompt"], "")
        self.assertEqual(self.save(apiKey="override", autoUpdate="true", appApiServer="evil"), {})
        with self.assertRaises(ValueError):
            self.save(defaultPrompt="x" * 20001)
        with self.assertRaises(ValueError):
            self.save(settings="{}")
        with self.assertRaises(ValueError):
            settings_form({}, {})