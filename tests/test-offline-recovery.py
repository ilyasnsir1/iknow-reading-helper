"""Exercise offline recovery only in temporary copies of signed release fixtures."""
from pathlib import Path
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parents[1]
specification = importlib.util.spec_from_file_location("offline_recovery", ROOT / "tools/support/recover_update.py")
recovery = importlib.util.module_from_spec(specification)
specification.loader.exec_module(recovery)


class Terminal(io.StringIO):
    def isatty(self):
        return True


def snapshot(root):
    return {str(path.relative_to(root)): (path.stat().st_mtime_ns, path.read_bytes())
            for path in root.rglob("*") if path.is_file()}


@unittest.skipUnless(os.name == "nt", "Windows native signature checks")
class OfflineRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old = WORKSPACE / "outputs/releases/1.34.1/unpacked"
        cls.release = WORKSPACE / "outputs/releases/1.35.3/github"
        if not cls.old.is_dir() or not cls.release.is_dir():
            raise unittest.SkipTest("Local signed release fixtures are not available")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="iknow-offline-recovery-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.app, self.cache, self.assets = self.root / "existing app ü", self.root / "learning data ü", self.root / "offline release"
        shutil.copytree(self.old, self.app)
        shutil.copytree(self.release, self.assets)
        (self.cache / "models").mkdir(parents=True)
        (self.cache / "models/precious.bin").write_bytes(b"Retain the installed model")
        (self.cache / "packs").mkdir()
        (self.cache / "packs/course.json").write_bytes(b'{"prepared":true}')
        (self.app / "personal-notes.txt").write_bytes(b"Retain this unmanaged note")
        self.output = io.StringIO()
        self.registry = patch.object(recovery, "registered_helper", side_effect=AssertionError("Tests must not read actual registration"))
        self.registry.start()
        self.addCleanup(self.registry.stop)

    def run_recovery(self, *, apply=False, stdin=None):
        with patch.object(recovery, "brave_is_running", return_value=False):
            return recovery.recover(self.app, self.cache, self.assets, apply=apply, stdin=stdin, stdout=self.output)

    def test_check_streams_every_file_and_writes_nothing(self):
        before = snapshot(self.root)
        result = self.run_recovery()
        self.assertEqual(result["version"], "1.35.3")
        self.assertEqual(snapshot(self.root), before)
        self.assertIn(str(self.app), self.output.getvalue())
        self.assertIn("No files were written", self.output.getvalue())

    def test_apply_preserves_existing_folder_models_cache_key_and_notes(self):
        key_before = (self.app / "helper/update-config.json").read_bytes()
        with patch.multiple(subprocess, run=unittest.mock.DEFAULT, Popen=unittest.mock.DEFAULT) as children:
            for child in children.values():
                child.side_effect = AssertionError("Offline recovery must not start children")
            result = self.run_recovery(apply=True, stdin=Terminal("UPDATE\n"))
        self.assertEqual(result["version"], "1.35.3")
        self.assertEqual(json.loads((self.app / "extension/manifest.json").read_bytes())["version"], "1.35.3")
        self.assertEqual((self.app / "helper/update-config.json").read_bytes(), key_before)
        self.assertEqual((self.cache / "models/precious.bin").read_bytes(), b"Retain the installed model")
        self.assertEqual((self.cache / "packs/course.json").read_bytes(), b'{"prepared":true}')
        self.assertEqual((self.app / "personal-notes.txt").read_bytes(), b"Retain this unmanaged note")
        updater = recovery.load_updater()
        for name, expected in result["files"].items():
            self.assertEqual(updater.digest(self.app / name), expected, name)
        state = updater.read_json(updater.state_path(self.cache, self.app))
        self.assertEqual(state["status"], "complete")
        stages = list(updater.update_root(self.cache, self.app).glob("stage-*"))
        self.assertEqual(len(stages), 1)
        self.assertTrue((stages[0] / "backup/RELEASE-FILES.json").is_file())
        self.assertEqual(updater.read_json(stages[0] / "journal.json")["state"], "complete")

    def test_modified_managed_file_stops_before_any_recovery_write(self):
        (self.app / "helper/updater.py").write_bytes(b"A local modification that must be retained")
        before = snapshot(self.root)
        with self.assertRaises(ValueError) as raised:
            self.run_recovery(apply=True, stdin=Terminal("UPDATE\n"))
        self.assertIn("changed locally", str(raised.exception))
        self.assertEqual(snapshot(self.root), before)

    def test_signature_or_archive_tampering_is_rejected_before_any_write(self):
        manifest = json.loads((self.assets / "update-manifest.json").read_bytes())
        for target in (self.assets / "update-manifest.sig", self.assets / manifest["asset"]["name"]):
            original = target.read_bytes()
            target.write_bytes((b"A" if original[:1] != b"A" else b"B") + original[1:])
            before = snapshot(self.root)
            with self.subTest(file=target.name), self.assertRaises(ValueError):
                self.run_recovery(apply=True, stdin=Terminal("UPDATE\n"))
            self.assertEqual(snapshot(self.root), before)
            target.write_bytes(original)

    def test_apply_requires_terminal_and_exact_confirmation(self):
        for source in (io.StringIO("UPDATE\n"), Terminal("update\n"), Terminal("\n")):
            before = snapshot(self.root)
            with self.subTest(terminal=source.isatty()), self.assertRaises(recovery.RecoveryError):
                self.run_recovery(apply=True, stdin=source)
            self.assertEqual(snapshot(self.root), before)

    def test_running_brave_is_rejected_without_killing_or_writing(self):
        before = snapshot(self.root)
        with patch.object(recovery, "brave_is_running", return_value=True):
            with self.assertRaises(recovery.RecoveryError) as raised:
                recovery.recover(self.app, self.cache, self.assets, apply=True, stdin=Terminal("UPDATE\n"), stdout=self.output)
        self.assertIn("Close Brave", str(raised.exception))
        self.assertEqual(snapshot(self.root), before)

    def test_transaction_failure_reuses_rollback_and_retains_user_data(self):
        updater = recovery.load_updater()
        real_apply = updater.transaction_apply
        before = snapshot(self.app)
        def fail_transaction(stage):
            return real_apply(stage, fail_after=2)
        with patch.object(recovery, "load_updater", return_value=updater), patch.object(updater, "transaction_apply", side_effect=fail_transaction):
            with self.assertRaises(OSError):
                self.run_recovery(apply=True, stdin=Terminal("UPDATE\n"))
        # Restoring a file changes its timestamp; its complete contents must match.
        self.assertEqual({name: value[1] for name, value in snapshot(self.app).items()},
                         {name: value[1] for name, value in before.items()})
        stages = list(updater.update_root(self.cache, self.app).glob("stage-*"))
        self.assertEqual(updater.read_json(stages[0] / "journal.json")["state"], "rolled_back")
        self.assertEqual((self.cache / "models/precious.bin").read_bytes(), b"Retain the installed model")

    def test_unexpected_installed_publisher_key_fails_closed(self):
        target = self.app / "helper/update-config.json"
        config = json.loads(target.read_bytes())
        config["publicKeyXml"] = config["publicKeyXml"].replace("mgV9", "ngV9", 1)
        target.write_text(json.dumps(config), encoding="utf-8")
        before = snapshot(self.root)
        with self.assertRaises(recovery.RecoveryError) as raised:
            self.run_recovery()
        self.assertIn("publisher key", str(raised.exception))
        self.assertEqual(snapshot(self.root), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
