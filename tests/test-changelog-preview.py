"""The owner preview stages readable notes without exporting publisher secrets."""
from pathlib import Path
import importlib.util
import copy
import json
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("changelog_configuration", SOURCE / "tools/changelog/configure-authoring.py")
configuration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configuration)


class PreviewTests(unittest.TestCase):
    def test_publication_layout_does_not_finalize_or_rewrite_the_private_draft(self):
        draft = {"schemaVersion": 1, "entries": [{"id": "new-study", "status": "unreleased", "version": None, "date": None, "title": "New ways to learn", "summary": "", "changes": [{"type": "added", "title": "Practice", "description": "Practise saved words.", "details": [], "images": []}]}, {"id": "old", "status": "released", "version": "1.40.5", "date": "2026-10-29", "title": "Romaji", "summary": "", "changes": [{"type": "added", "title": "Romaji style", "description": "Choose a reading style.", "details": [], "images": []}]}]}
        before = copy.deepcopy(draft)
        view = configuration.release_view(draft, "1.41.0", "2026-10-31")
        self.assertEqual(view["entries"][0]["version"], "1.41.0")
        self.assertEqual(view["entries"][0]["status"], "released")
        self.assertEqual(view["entries"][0]["date"], "2026-10-31")
        self.assertEqual(view["entries"][1], draft["entries"][1])
        self.assertEqual(before, draft)
        for version, day in (("1.40.5", "2026-10-31"), ("1.34.0", "2026-10-31"), ("invalid", "2026-10-31"), ("1.41.0", "2026-02-30")):
            with self.subTest(version=version, day=day), self.assertRaises(ValueError):
                configuration.release_view(draft, version, day)

    def test_only_reader_assets_and_referenced_notes_are_staged(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, output, publisher = root / "work/source", root / "preview", root / "publisher"
            for name in ("changelog.html", "changelog.css", "changelog.js", "changelog-editor.css", "theme.css", "theme.js", "icons/icon128.png"):
                target = source / "extension" / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((SOURCE / "extension" / name).read_bytes())
            (source / "tools/changelog").mkdir(parents=True)
            (source / "tools/changelog/preview-theme-storage.js").write_bytes((SOURCE / "tools/changelog/preview-theme-storage.js").read_bytes())
            publisher.mkdir()
            (publisher / "signing-key.xml").write_text("private publisher sentinel")
            (source / "extension/changelog.json").write_text('{"published":"unchanged"}')
            source_before = {str(p.relative_to(source)): p.read_bytes() for p in source.rglob("*") if p.is_file()}
            draft = {"schemaVersion": 1, "entries": [{"id": "next", "status": "unreleased", "version": None, "date": None, "title": "Next update", "summary": "", "changes": [{"type": "fixed", "title": "Practice", "description": "Clearer controls.", "details": [], "images": []}]}]}
            with patch.object(configuration.author, "PUBLISHER_ROOT", publisher):
                configuration.preview_draft(source, output, {"draft": draft, "images": []})
            self.assertEqual(json.loads((output / "changelog.json").read_bytes()), draft)
            page = (output / "changelog.html").read_text(encoding="utf-8")
            self.assertIn('<script src="changelog.js" defer>', page)
            self.assertNotIn('<script src="changelog-editor.js"', page)
            self.assertNotIn('<script src="diagnostic-page-errors.js"', page)
            self.assertTrue((output / "changelog-preview-storage.js").is_file())
            self.assertFalse((output / "signing-key.xml").exists())
            self.assertFalse((output / "helper").exists())
            self.assertEqual(source_before, {str(p.relative_to(source)): p.read_bytes() for p in source.rglob("*") if p.is_file()})
            self.assertEqual((publisher / "signing-key.xml").read_text(), "private publisher sentinel")

    def test_installed_source_and_publisher_folders_cannot_be_preview_targets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, publisher = root / "work/source", root / "publisher"
            with patch.object(configuration.author, "PUBLISHER_ROOT", publisher):
                for target in (source, source / "extension", root / "outputs/live", publisher / "notes", root):
                    with self.subTest(target=target), self.assertRaises(ValueError):
                        configuration.preview_draft(source, target, {"draft": {}, "images": []})
            self.assertFalse((source / "extension").exists())


if __name__ == "__main__":
    unittest.main()
