"""Isolated updater security/transaction tests; never touch installed user data."""
from pathlib import Path
import base64
import hashlib
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "outputs/iknow-lesehilfe/helper"
if not HELPER.exists():
    HELPER = ROOT / "helper"
sys.path.insert(0, str(HELPER))
import updater


def sha(data):
    return hashlib.sha256(data).hexdigest()


def ps(script, payload=b""):
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    result = subprocess.run(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                            input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError("Test RSA operation failed: " + result.stderr.decode("utf-8", "replace")[:300])
    return result.stdout


class UpdaterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.name != "nt":
            raise unittest.SkipTest("Windows RSA tests require Windows")
        cls.temporary = tempfile.TemporaryDirectory(prefix="iknow-updater-test-")
        cls.root = Path(cls.temporary.name)
        keys = json.loads(ps("$r=New-Object Security.Cryptography.RSACryptoServiceProvider(2048);$r.PersistKeyInCsp=$false;@{public=$r.ToXmlString($false);private=$r.ToXmlString($true)}|ConvertTo-Json -Compress;$r.Dispose()"))
        cls.public, cls.private = keys["public"], keys["private"]
        cls.settings = {"schema": 1, "enabled": True, "owner": "example-project", "repository": "reading-helper", "channel": "stable", "publicKeyXml": cls.public}
        cls.counter = 0

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def sign(self, data):
        payload = json.dumps({"key": self.private, "data": base64.b64encode(data).decode("ascii")}).encode("ascii")
        return ps("$v=[Console]::In.ReadToEnd()|ConvertFrom-Json;$r=New-Object Security.Cryptography.RSACryptoServiceProvider;$r.PersistKeyInCsp=$false;$r.FromXmlString($v.key);[Console]::Out.Write([Convert]::ToBase64String($r.SignData([Convert]::FromBase64String($v.data),'SHA256')));$r.Dispose()", payload)

    def fixture(self):
        type(self).counter += 1
        case = self.root / str(type(self).counter)
        app, cache = case / "App folder ü", case / "Local cache ü"
        app.mkdir(parents=True); cache.mkdir()
        baseline = {
            "extension/manifest.json": json.dumps({"manifest_version": 3, "version": "1.34.0"}).encode(),
            "extension/popup.js": b"old popup code\n",
            "helper/native_host.py": b'HOST_VERSION = "1.16.0"\n',
            "helper/update-config.json": json.dumps(self.settings).encode(),
            "README.md": b"Old README\n",
            "OBSOLETE.md": b"Obsolete managed documentation\n",
        }
        for name, data in baseline.items():
            target = app / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
        index = {"version": "1.34.0", "sha256": {name: sha(data) for name, data in baseline.items()}}
        (app / "RELEASE-FILES.json").write_text(json.dumps(index), encoding="utf-8")
        (app / "personal-notes.txt").write_bytes(b"Keep my notes\n")
        (cache / "models").mkdir(); (cache / "models/model.bin").write_bytes(b"Existing expensive model\n")
        (cache / "packs").mkdir(); (cache / "packs/course.json").write_bytes(b'{"saved":true}')
        new = {
            "extension/manifest.json": json.dumps({"manifest_version": 3, "version": "1.35.0"}).encode(),
            "extension/popup.js": b"new popup code\n",
            "helper/native_host.py": b'HOST_VERSION = "1.17.0"\n',
            "helper/update-config.json": json.dumps(self.settings).encode(),
            "helper/new-helper.py": b"# A new managed file\n",
            "README.md": b"New README\n",
        }
        index = {"version": "1.35.0", "sha256": {name: sha(data) for name, data in new.items()}}
        new["RELEASE-FILES.json"] = json.dumps(index).encode()
        archive = case / "update.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for name, data in new.items():
                bundle.writestr(name, data)
        manifest = {"schema": 1, "version": "1.35.0", "helperVersion": "1.17.0", "minimumHelperVersion": "1.16.0",
                    "asset": {"name": "reading-helper-1.35.0.zip", "url": "https://github.com/example-project/reading-helper/releases/download/v1.35.0/reading-helper-1.35.0.zip",
                              "size": archive.stat().st_size, "sha256": updater.digest(archive)},
                    "files": {name: sha(data) for name, data in new.items()}, "deleteFiles": ["OBSOLETE.md"]}
        operation = uuid.uuid4().hex
        stage = updater.update_root(cache, app) / ("stage-" + operation)
        stage.mkdir(parents=True)
        raw = json.dumps(manifest, indent=2).encode()
        (stage / "update-manifest.json").write_bytes(raw)
        (stage / "update-manifest.sig").write_bytes(self.sign(raw))
        updater.atomic_json(stage / "transaction.json", {"schema": 1, "appRoot": str(app), "cacheRoot": str(cache), "operation": operation,
                                                       "parentPid": 99999999, "helperVersion": "1.16.0", "publicKeyXml": self.public,
                                                       "owner": self.settings["owner"], "repository": self.settings["repository"]})
        updater.extract_archive(archive, stage / "files", manifest)
        return app, cache, stage, archive, manifest, new

    def test_01_real_windows_signature_and_version_checks(self):
        raw = b'{"signed":"exact bytes"}\n'
        signature = self.sign(raw)
        updater.verify_signature(raw, signature + b"\n", self.public)
        with self.assertRaises(updater.UpdateError):
            updater.verify_signature(raw + b" ", signature, self.public)
        with self.assertRaises(updater.UpdateError):
            updater.verify_signature(raw, b"not-base64", self.public)
        app, cache, stage, archive, manifest, new = self.fixture()
        updater.validate_manifest(json.dumps(manifest).encode(), self.settings, "1.34.0", "1.16.0")
        with self.assertRaises(updater.UpdateError):
            updater.validate_manifest(json.dumps(manifest).encode(), self.settings, "1.36.0", "1.16.0")
        with self.assertRaises(updater.UpdateError):
            updater.validate_manifest(json.dumps(manifest).encode(), self.settings, "1.34.0", "1.15.0")
        for bad in ("1.35", "01.35.0", "1.35.0-beta", "-1.0.0"):
            with self.assertRaises(updater.UpdateError):
                updater.version(bad)

    def test_02_urls_and_windows_paths(self):
        good = "https://github.com/example-project/reading-helper/releases/download/v1/update.zip"
        self.assertEqual(updater.safe_url(good, self.settings), good)
        for bad in ("http://github.com/example-project/reading-helper/releases/download/a/a.zip",
                    "https://github.com.evil.test/example-project/reading-helper/releases/download/a/a.zip",
                    "https://github.com/other/reading-helper/releases/download/a/a.zip", "https://user:pw@github.com/example-project/reading-helper/releases/download/a/a.zip",
                    "https://github.com/example-project/reading-helper/releases/download/%2e%2e/file.zip"):
            with self.assertRaises(updater.UpdateError):
                updater.safe_url(bad, self.settings)
        for bad in ("../outside.txt", "/absolute.txt", "C:/outside.txt", "helper/../outside.txt", "helper\\outside.txt", "helper/NUL.txt", "helper/file.py:stream",
                    "helper/file.py.", "helper/file.py ", "helper/a?.py", "runtime/model.bin", ".git/config", "helper/.hidden/code.py"):
            with self.assertRaises(updater.UpdateError, msg=bad):
                updater.managed_path(bad)
        with self.assertRaises(updater.UpdateError):
            updater.strict_json(b'{"schema":1,"schema":2}')

    def test_03_archive_invariants(self):
        app, cache, stage, archive, manifest, new = self.fixture()
        for bad in ("../escape.txt", "helper/NUL.py", "extension\\popup.js"):
            target = stage / (uuid.uuid4().hex + ".zip")
            with zipfile.ZipFile(target, "w") as bundle:
                bundle.writestr(bad, b"unsafe")
            with self.assertRaises(updater.UpdateError):
                updater.extract_archive(target, stage / uuid.uuid4().hex, manifest)
        linked = stage / "linked.zip"
        with zipfile.ZipFile(linked, "w") as bundle:
            entry = zipfile.ZipInfo("helper/new-helper.py"); entry.create_system = 3
            entry.external_attr = (stat.S_IFLNK | 0o777) << 16
            bundle.writestr(entry, b"../../outside")
        with self.assertRaises(updater.UpdateError):
            updater.extract_archive(linked, stage / "linked-output", manifest)
        corrupt = stage / "corrupt.zip"
        with zipfile.ZipFile(corrupt, "w") as bundle:
            for name, data in new.items():
                bundle.writestr(name, b"altered" if name == "README.md" else data)
        with self.assertRaises(updater.UpdateError):
            updater.extract_archive(corrupt, stage / "corrupt-output", manifest)
        with self.assertRaises(updater.UpdateError):
            updater.extract_archive(archive, stage / "too-large", {**manifest, "files": {"README.md": "0" * 64}})

    def test_04_local_edits_and_unmanaged_collision_stop_update(self):
        app, cache, stage, archive, manifest, new = self.fixture()
        updater.validate_baseline(app, manifest)
        original = (app / "README.md").read_bytes()
        (app / "README.md").write_bytes(b"User edited this")
        with self.assertRaisesRegex(updater.UpdateError, "changed locally"):
            updater.validate_baseline(app, manifest)
        (app / "README.md").write_bytes(original)
        (app / "helper/new-helper.py").write_bytes(b"My own helper file")
        with self.assertRaisesRegex(updater.UpdateError, "changed locally"):
            updater.validate_baseline(app, manifest)
        self.assertEqual((app / "personal-notes.txt").read_bytes(), b"Keep my notes\n")

    def test_05_transaction_success_preserves_models_and_unknown_files(self):
        app, cache, stage, archive, manifest, new = self.fixture()
        before = (app / "extension/popup.js").read_bytes()
        output = updater.transaction_apply(stage)
        self.assertEqual(output["version"], "1.35.0")
        for name, data in new.items():
            self.assertEqual((app / name).read_bytes(), data)
        self.assertEqual((stage / "backup/extension/popup.js").read_bytes(), before)
        self.assertFalse((app / "OBSOLETE.md").exists())
        self.assertEqual((app / "personal-notes.txt").read_bytes(), b"Keep my notes\n")
        self.assertEqual((cache / "models/model.bin").read_bytes(), b"Existing expensive model\n")
        self.assertEqual((cache / "packs/course.json").read_bytes(), b'{"saved":true}')

    def test_06_write_failure_rolls_back_every_changed_file(self):
        app, cache, stage, archive, manifest, new = self.fixture()
        before = {p.relative_to(app).as_posix(): p.read_bytes() for p in app.rglob("*") if p.is_file()}
        with self.assertRaisesRegex(OSError, "Injected"):
            updater.transaction_apply(stage, fail_after=5)
        after = {p.relative_to(app).as_posix(): p.read_bytes() for p in app.rglob("*") if p.is_file()}
        self.assertEqual(before, after)
        self.assertEqual(updater.read_json(stage / "journal.json")["state"], "rolled_back")

    def test_07_interrupted_transaction_recovers_before_reporting_status(self):
        app, cache, stage, archive, manifest, new = self.fixture()
        name = "extension/popup.js"
        original = (app / name).read_bytes()
        (stage / "backup/extension").mkdir(parents=True)
        (stage / "backup" / name).write_bytes(original)
        (app / name).write_bytes(new[name])
        updater.atomic_json(stage / "journal.json", {"state": "applying", "files": [{"name": name, "existed": True}]})
        transaction = updater.read_json(stage / "transaction.json")
        updater.save_state(cache, {"status": "installing", "ownerPid": 99999999, "runnerPid": 99999998, "operation": transaction["operation"],
                                   "stageDirectory": str(stage), "latestVersion": "1.35.0"}, app)
        state = updater.status(cache, app)
        self.assertEqual(state["status"], "error")
        self.assertEqual((app / name).read_bytes(), original)
        self.assertEqual(updater.read_json(stage / "journal.json")["state"], "rolled_back")

    def test_08_real_cross_process_locks_prevent_running_job_update(self):
        app, cache, stage, archive, manifest, new = self.fixture()
        held = cache / "jobs/123.lock"
        marker = cache / "locked"
        script = "import sys,time;from pathlib import Path;sys.path.insert(0,sys.argv[1]);import updater;l=updater.FileLock(Path(sys.argv[2]));assert l.acquire();Path(sys.argv[3]).touch();time.sleep(15)"
        process = subprocess.Popen([sys.executable, "-c", script, str(HELPER), str(held), str(marker)],
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            end = time.monotonic() + 5
            while not marker.exists() and time.monotonic() < end:
                time.sleep(.03)
            self.assertTrue(marker.exists())
            with self.assertRaises(updater.UpdateBusy):
                updater.activity_locks(cache)
        finally:
            process.terminate(); process.wait(timeout=5)
        locks = updater.activity_locks(cache)
        for lock in locks:
            lock.release()

    def test_09_release_api_validates_signed_assets_before_archive(self):
        app, cache, stage, archive, manifest, new = self.fixture()
        metadata = (stage / "update-manifest.json").read_bytes()
        signature = (stage / "update-manifest.sig").read_bytes()
        release = {"draft": False, "prerelease": False, "assets": [
            {"name": "update-manifest.json", "browser_download_url": "https://github.com/example-project/reading-helper/releases/download/v1.35.0/update-manifest.json"},
            {"name": "update-manifest.sig", "browser_download_url": "https://github.com/example-project/reading-helper/releases/download/v1.35.0/update-manifest.sig"},
            {"name": manifest["asset"]["name"], "browser_download_url": manifest["asset"]["url"], "size": manifest["asset"]["size"]}]}
        def fetch(url, limit):
            if url.endswith("/latest"):
                return json.dumps(release).encode()
            if url.endswith(".json"):
                return metadata
            return signature
        with patch.object(updater, "download", side_effect=fetch):
            got, raw, sig = updater.get_release(self.settings, "1.34.0", "1.16.0")
            self.assertEqual(got, manifest)
        release["assets"][-1]["size"] += 1
        with patch.object(updater, "download", side_effect=fetch), self.assertRaises(updater.UpdateError):
            updater.get_release(self.settings, "1.34.0", "1.16.0")

    def test_10_runner_real_subprocess_handoff_and_version_scope(self):
        app, cache, stage, archive, manifest, new = self.fixture()
        shutil.copy2(HELPER / "updater.py", stage / "updater.py")
        shutil.copy2(HELPER / "update_runner.py", stage / "update_runner.py")
        launcher = stage / "launcher.py"
        launcher.write_text("import os,json,subprocess,sys,time\nfrom pathlib import Path\nsys.path.insert(0,str(Path(__file__).parent))\nimport updater\ns=Path(__file__).parent\nt=updater.read_json(s/'transaction.json')\nt['parentPid']=os.getpid();updater.atomic_json(s/'transaction.json',t)\np=subprocess.Popen([sys.executable,'-u',str(s/'update_runner.py'),str(s)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW|subprocess.DETACHED_PROCESS)\nupdater.save_state(t['cacheRoot'],{'status':'installing','ownerPid':os.getpid(),'runnerPid':p.pid,'operation':t['operation'],'stageDirectory':str(s),'latestVersion':'1.35.0'},t['appRoot'])\n(s/'ready').touch()\ntime.sleep(.3)\n", encoding="utf-8")
        other = cache.parent / "Other installed folder"
        (other / "extension").mkdir(parents=True)
        (other / "extension/manifest.json").write_text('{"version":"9.9.9"}')
        subprocess.run([sys.executable, str(launcher)], check=True, timeout=8, creationflags=subprocess.CREATE_NO_WINDOW)
        deadline = time.monotonic() + 15
        result = {}
        while time.monotonic() < deadline:
            result = updater.status(cache, app)
            if result.get("status") in {"complete", "error"}:
                break
            time.sleep(.1)
        self.assertEqual(result.get("status"), "complete", result)
        self.assertEqual(updater.current_version(app), "1.35.0")
        self.assertEqual(updater.status(cache, other)["currentVersion"], "9.9.9")
        self.assertNotIn("operation", result)
        self.assertNotIn("stageDirectory", result)
        self.assertEqual((cache / "models/model.bin").read_bytes(), b"Existing expensive model\n")

    def test_11_permission_expansion_requires_manual_adoption(self):
        app, cache, stage, archive, manifest, new = self.fixture()
        updater.validate_permissions(app, stage / "files")
        path = stage / "files/extension/manifest.json"
        base = json.loads(path.read_text())
        for addition in ({"permissions": ["tabs"]}, {"host_permissions": ["https://*/*"]},
                         {"content_scripts": [{"matches": ["https://example.com/*"]}]},
                         {"externally_connectable": {"matches": ["https://example.com/*"]}}):
            path.write_text(json.dumps({**base, **addition}))
            with self.assertRaisesRegex(updater.UpdateError, "manually"):
                updater.validate_permissions(app, stage / "files")

    def test_12_explicit_check_recovers_dead_operation_before_lock(self):
        app, cache, stage, archive, manifest, new = self.fixture()
        shutil.copy2(HELPER / "updater.py", app / "helper/updater.py")
        spec = importlib.util.spec_from_file_location("isolated_updater_12", app / "helper/updater.py")
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        operation = updater.read_json(stage / "transaction.json")["operation"]
        module.save_state(cache, {"status": "installing", "ownerPid": 99999999, "runnerPid": 99999998,
                                "operation": operation, "stageDirectory": str(stage), "latestVersion": "1.35.0"})
        replies, finished = [], threading.Event()
        def send(reply):
            replies.append(reply); finished.set()
        with patch.object(module, "get_release", return_value=(manifest, b"", b"")):
            module.handle({"type": "update:check", "requestId": "dead-operation-check"}, cache, send, "1.16.0")
            self.assertTrue(finished.wait(5))
        self.assertTrue(replies[0]["ok"], replies)
        self.assertEqual(replies[0]["state"]["status"], "available")


if __name__ == "__main__":
    unittest.main(verbosity=2)
