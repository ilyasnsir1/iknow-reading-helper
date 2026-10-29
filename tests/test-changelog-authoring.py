"""Isolated maintainer capability/draft checks; no installed files or keys used."""
from pathlib import Path
import base64
import hashlib
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / "helper"))
import changelog_authoring as author


def keys():
    # Deliberately disposable mathematical RSA fixture, unrelated to publication.
    p, q, e = 2**1024 - 109, 2**1024 - 159, 65537
    while math.gcd(p, q) != 1 or math.gcd(e, math.lcm(p - 1, q - 1)) != 1:
        q -= 2
    d = pow(e, -1, math.lcm(p - 1, q - 1))
    values = {"Modulus": p * q, "Exponent": e, "D": d, "P": p, "Q": q, "DP": d % (p - 1), "DQ": d % (q - 1), "InverseQ": pow(q, -1, p)}
    def xml(names):
        return "<RSAKeyValue>" + "".join(f"<{name}>" + base64.b64encode(values[name].to_bytes((values[name].bit_length() + 7) // 8, "big")).decode() + f"</{name}>" for name in names) + "</RSAKeyValue>"
    return xml(values), xml(("Modulus", "Exponent"))


PRIVATE, PUBLIC = keys()
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ioAAAAASUVORK5CYII=")


class AuthorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="iknow-changelog-author-")
        self.root = Path(self.temp.name)
        self.app, self.publisher = self.root / "app", self.root / "publisher"
        (self.app / "helper").mkdir(parents=True)
        (self.app / "extension/changelog-media").mkdir(parents=True)
        (self.app / "helper/update-config.json").write_text(json.dumps({"publicKeyXml": PUBLIC}))
        self.draft = {"schemaVersion": 1, "entries": [{"id": "romaji-style", "version": None, "status": "unreleased", "date": None, "title": "Romaji", "summary": "", "changes": [{"type": "added", "title": "Choose a style", "description": "Source spelling or pronunciation.", "details": [], "images": []}]}]}
        (self.app / "extension/changelog.json").write_bytes(author._encode(self.draft))
        self.before = {str(file.relative_to(self.app)): file.read_bytes() for file in self.app.rglob("*") if file.is_file()}

    def tearDown(self):
        self.assertEqual(self.before, {str(file.relative_to(self.app)): file.read_bytes() for file in self.app.rglob("*") if file.is_file()})
        self.temp.cleanup()

    def enable(self):
        self.publisher.mkdir()
        (self.publisher / "signing-key.xml").write_text(PRIVATE)
        (self.publisher / "changelog-authoring.json").write_text(json.dumps({"schemaVersion": 1, "enabled": True, "publisherKeySha256": hashlib.sha256(PUBLIC.encode()).hexdigest()}))

    def call(self, action, **kwargs):
        return author.execute({"action": action, **kwargs}, self.app, publisher_root=self.publisher)

    def test_unconfigured_reader_never_writes(self):
        self.assertEqual(self.call("status"), {"ok": True, "available": False, "role": "reader"})
        for action in ("load", "save", "image:add", "image:get", "image:remove"):
            with self.assertRaisesRegex(author.AuthorError, "only on the maintainer"):
                self.call(action, role="maintainer", publisherRoot=str(self.publisher), expectedRevision=0)
        self.assertFalse(self.publisher.exists())

    def test_private_key_is_required_and_mathematically_consistent(self):
        self.enable()
        self.assertTrue(self.call("status")["available"])
        (self.publisher / "signing-key.xml").write_text(PUBLIC)
        self.assertFalse(self.call("status")["available"])
        (self.publisher / "signing-key.xml").write_text(PRIVATE.replace("<D>", "<D>AA"))
        self.assertFalse(self.call("status")["available"])
        (self.publisher / "signing-key.xml").write_text(PRIVATE)
        (self.publisher / "changelog-authoring.json").write_text('{"enabled":true,"schemaVersion":1,"publisherKeySha256":"wrong"}')
        self.assertFalse(self.call("status")["available"])

    def test_seed_save_and_revision_conflict_preserve_app(self):
        self.enable()
        state = self.call("load")
        self.assertEqual(state["revision"], 0)
        state["draft"]["entries"][0]["title"] = "Updated title"
        saved = self.call("save", draft=state["draft"], expectedRevision=0)
        self.assertEqual(saved["revision"], 1)
        self.assertEqual(self.call("load")["draft"]["entries"][0]["title"], "Updated title")
        with self.assertRaisesRegex(author.AuthorError, "another window"):
            self.call("save", draft=self.draft, expectedRevision=0)
        self.assertEqual(self.call("load")["revision"], 1)

    def test_image_upload_get_reference_remove(self):
        self.enable()
        uploaded = self.call("image:add", base64=base64.b64encode(PNG).decode(), fileName="my screenshot.png", mime="image/png", expectedRevision=0)
        src = uploaded["image"]["src"]
        self.assertTrue(author.OWN_IMAGE.fullmatch(src))
        self.assertNotIn("base64", uploaded["images"][0])
        self.assertEqual(base64.b64decode(self.call("image:get", src=src)["image"]["base64"]), PNG)
        draft = uploaded["draft"]
        draft["entries"][0]["changes"][0]["images"] = [{"src": src, "alt": "Screenshot"}]
        saved = self.call("save", draft=draft, expectedRevision=1)
        self.assertEqual(saved["revision"], 2)
        with self.assertRaisesRegex(author.AuthorError, "save first"):
            self.call("image:remove", src=src, expectedRevision=2)
        saved["draft"]["entries"][0]["changes"][0]["images"] = []
        self.call("save", draft=saved["draft"], expectedRevision=2)
        removed = self.call("image:remove", src=src, expectedRevision=3)
        self.assertEqual(removed["revision"], 4)
        self.assertEqual(removed["images"], [])
        self.assertFalse((self.publisher / "changelog/images" / src.split("/")[1]).exists())

    def test_bad_image_inputs_and_paths_are_rejected(self):
        self.enable()
        for src in ("../signing-key.xml", "changelog-media/../../key.png", "file:///key.png", "https://example.com/a.png", "changelog-media/published.png"):
            with self.assertRaises(author.AuthorError):
                self.call("image:get", src=src)
            with self.assertRaises(author.AuthorError):
                self.call("image:remove", src=src, expectedRevision=0)
        for raw, mime, file_name in ((b"<svg onload=alert(1)/>", "image/svg+xml", "a.svg"), (PNG, "text/html", "a.png"), (PNG, "image/png", "../a.png"), (b"x" * (author.MAX_IMAGE + 1), "image/png", "large.png")):
            with self.assertRaises(author.AuthorError):
                self.call("image:add", base64=base64.b64encode(raw).decode(), mime=mime, fileName=file_name, expectedRevision=0)
        enormous = bytearray(PNG); enormous[16:24] = struct.pack(">II", 16000, 16000)
        with self.assertRaises(author.AuthorError):
            self.call("image:add", base64=base64.b64encode(enormous).decode(), mime="image/png", fileName="huge.png", expectedRevision=0)

    def test_invalid_drafts_and_missing_assets_are_rejected(self):
        self.enable()
        with self.assertRaises(author.AuthorError):
            self.call("save", draft={**self.draft, "schemaVersion": True}, expectedRevision=0)
        for patch in ({"title": "x" * 161}, {"id": "../../escape"}, {"status": "released"}, {"date": "2026-02-30"}):
            draft = json.loads(json.dumps(self.draft)); draft["entries"][0].update(patch)
            with self.assertRaises(author.AuthorError):
                self.call("save", draft=draft, expectedRevision=0)
        for src in ("https://example.com/a.png", "changelog-media/../key.png", "changelog-media/missing.png"):
            draft = json.loads(json.dumps(self.draft)); draft["entries"][0]["changes"][0]["images"] = [{"src": src, "alt": "No"}]
            with self.assertRaises(author.AuthorError):
                self.call("save", draft=draft, expectedRevision=0)
        self.assertEqual(self.call("load")["revision"], 0)

    def test_published_former_upload_is_not_treated_as_missing_local_asset(self):
        src = "changelog-media/author-" + "a" * 32 + ".png"
        (self.app / "extension" / src).write_bytes(PNG)
        self.before[str((self.app / "extension" / src).relative_to(self.app))] = PNG
        self.enable()
        self.draft["entries"][0]["changes"][0]["images"] = [{"src": src, "alt": "Bundled old upload"}]
        saved = self.call("save", draft=self.draft, expectedRevision=0)
        self.assertEqual(saved["revision"], 1)
        with self.assertRaises(author.AuthorError):
            self.call("image:remove", src=src, expectedRevision=1)

    def test_changed_source_marks_draft_without_modifying_or_merging_it(self):
        self.enable()
        self.draft["entries"][0]["title"] = "Local unsent edit"
        initial = self.call("save", draft=self.draft, expectedRevision=0)
        self.assertFalse(initial["sourceChanged"])
        stored_path = self.publisher / "changelog/draft.json"
        original_saved = stored_path.read_bytes()
        published = json.loads((self.app / "extension/changelog.json").read_bytes())
        published["entries"].append({**published["entries"][0], "id": "new-release", "title": "New published entry"})
        source_path = self.app / "extension/changelog.json"
        source_path.write_bytes(author._encode(published))
        self.before[str(source_path.relative_to(self.app))] = source_path.read_bytes()
        loaded = self.call("load")
        self.assertTrue(loaded["sourceChanged"])
        self.assertEqual(loaded["revision"], 1)
        self.assertEqual(len(loaded["draft"]["entries"]), 1)
        self.assertEqual(loaded["draft"]["entries"][0]["title"], "Local unsent edit")
        self.assertEqual(stored_path.read_bytes(), original_saved)
        with self.assertRaises(author.AuthorError):
            self.call("rebase", expectedRevision=1)
        rebased = author.rebase(self.app, publisher_root=self.publisher, expected_revision=1)
        self.assertFalse(rebased["sourceChanged"])
        self.assertEqual([entry["id"] for entry in rebased["draft"]["entries"]], ["romaji-style", "new-release"])
        self.assertEqual(rebased["draft"]["entries"][0]["title"], "Local unsent edit")

    def test_legacy_draft_and_now_published_content_are_compatible(self):
        self.enable()
        state = self.call("save", draft=self.draft, expectedRevision=0)
        saved_path = self.publisher / "changelog/draft.json"
        legacy = json.loads(saved_path.read_bytes()); legacy.pop("baseSourceHash")
        saved_path.write_bytes(author._encode(legacy))
        self.assertFalse(self.call("load")["sourceChanged"])
        legacy["draft"]["entries"][0]["title"] = "Legacy changed draft"
        saved_path.write_bytes(author._encode(legacy))
        self.assertTrue(self.call("load")["sourceChanged"])
        source_path = self.app / "extension/changelog.json"
        source_path.write_bytes(author._encode(legacy["draft"]))
        self.before[str(source_path.relative_to(self.app))] = source_path.read_bytes()
        self.assertFalse(self.call("load")["sourceChanged"])

    def test_native_status_is_lightweight_and_read_only(self):
        message = json.dumps({"type": "changelog:author", "action": "status", "requestId": "test"}).encode()
        completed = subprocess.run([sys.executable, "-B", str(SOURCE / "helper/native_host.py")], input=struct.pack("<I", len(message)) + message, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={**os.environ, "LOCALAPPDATA": str(self.root / "isolated-local")}, timeout=15)
        self.assertEqual(completed.returncode, 0, completed.stderr.decode())
        length = struct.unpack("<I", completed.stdout[:4])[0]
        result = json.loads(completed.stdout[4:4 + length])
        self.assertEqual(result, {"type": "changelog:author:result", "requestId": "test", "ok": True, "available": False, "role": "reader"})
        self.assertFalse((self.root / "isolated-local").exists())


class ExportTests(unittest.TestCase):
    def test_configure_and_explicit_export_never_publish_or_touch_keys(self):
        with tempfile.TemporaryDirectory(prefix="iknow-changelog-export-") as temporary:
            root = Path(temporary); app, local = root / "source", root / "local"
            publisher = local / "iKnowReadingHelperPublisher"; publisher.mkdir(parents=True)
            (publisher / "signing-key.xml").write_text(PRIVATE)
            (app / "helper").mkdir(parents=True); (app / "extension").mkdir(); (app / ".git").mkdir()
            (app / "tools/publisher").mkdir(parents=True); (app / "tools/publisher/stage-package.py").write_text("fixture")
            (app / "helper/update-config.json").write_text(json.dumps({"publicKeyXml": PUBLIC}))
            draft = {"schemaVersion": 1, "entries": [{"id": "romaji-style", "version": None, "status": "unreleased", "date": None, "title": "Romaji", "summary": "", "changes": [{"type": "added", "title": "Choose a style", "description": "Source or pronunciation.", "images": []}]}]}
            (app / "extension/changelog.json").write_bytes(author._encode(draft))
            env = {**os.environ, "LOCALAPPDATA": str(local)}
            tool = SOURCE / "tools/changelog/configure-authoring.py"
            enabled = subprocess.run([sys.executable, "-B", str(tool), "enable", "--source", str(app)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
            self.assertEqual(enabled.returncode, 0, enabled.stderr.decode())
            self.assertTrue(author.authorized(app, publisher))
            upload = author.execute({"action": "image:add", "fileName": "sample.png", "mime": "image/png", "base64": base64.b64encode(PNG).decode(), "expectedRevision": 0}, app, publisher_root=publisher)
            draft["entries"][0]["title"] = "Edited locally"
            draft["entries"][0]["changes"][0]["images"] = [{"src": upload["image"]["src"], "alt": "A sample"}]
            author.execute({"action": "save", "draft": draft, "expectedRevision": 1}, app, publisher_root=publisher)
            exported = subprocess.run([sys.executable, "-B", str(tool), "export", "--source", str(app)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
            self.assertEqual(exported.returncode, 0, exported.stderr.decode())
            self.assertEqual(json.loads((app / "extension/changelog.json").read_bytes())["entries"][0]["title"], "Edited locally")
            self.assertEqual((app / "extension" / upload["image"]["src"]).read_bytes(), PNG)
            self.assertEqual((publisher / "signing-key.xml").read_text(), PRIVATE)
            self.assertFalse((local / "iKnowLesehilfe").exists())
            current = json.loads((app / "extension/changelog.json").read_bytes())
            current["entries"].append({**current["entries"][0], "id": "new-release", "title": "Keep this newer entry"})
            (app / "extension/changelog.json").write_bytes(author._encode(current))
            source_before = (app / "extension/changelog.json").read_bytes()
            private_before = (publisher / "changelog/draft.json").read_bytes()
            blocked = subprocess.run([sys.executable, "-B", str(tool), "export", "--source", str(app)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
            self.assertNotEqual(blocked.returncode, 0)
            self.assertIn("Review both versions", blocked.stderr.decode())
            self.assertEqual((app / "extension/changelog.json").read_bytes(), source_before)
            self.assertEqual((publisher / "changelog/draft.json").read_bytes(), private_before)
            unreviewed = subprocess.run([sys.executable, "-B", str(tool), "rebase", "--source", str(app)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
            self.assertNotEqual(unreviewed.returncode, 0)
            reviewed = subprocess.run([sys.executable, "-B", str(tool), "rebase", "--reviewed", "--source", str(app)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
            self.assertEqual(reviewed.returncode, 0, reviewed.stderr.decode())
            ready = author.execute({"action": "load"}, app, publisher_root=publisher)
            self.assertFalse(ready["sourceChanged"])
            self.assertEqual([entry["id"] for entry in ready["draft"]["entries"]], ["romaji-style", "new-release"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
