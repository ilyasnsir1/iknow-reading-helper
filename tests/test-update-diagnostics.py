"""One export reproduces publisher checks without a separate support folder."""
from pathlib import Path
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "helper"))
import updater
import update_diagnostics as support


class UpdateDiagnosticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.name != "nt":
            cls.material = {"public": "<RSAKeyValue><Modulus>" + "a" * 140 + "</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>", "signature": base64.b64encode(b"s" * 384).decode()}
            return
        program = "$r=New-Object Security.Cryptography.RSACryptoServiceProvider(3072);$r.PersistKeyInCsp=$false;$raw=[Text.Encoding]::UTF8.GetBytes('{\"schema\":1,\"version\":\"1.35.0\",\"files\":{}}');@{public=$r.ToXmlString($false);signature=[Convert]::ToBase64String($r.SignData($raw,'SHA256'))}|ConvertTo-Json -Compress;$r.Dispose()"
        encoded = base64.b64encode(program.encode("utf-16le")).decode("ascii")
        completed = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], check=True, capture_output=True, timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
        cls.material = json.loads(completed.stdout)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="iknow-integrated-update-diagnostic-")
        self.root = Path(self.temp.name)
        self.app = self.root / "SECRET user folder ü" / "Application"
        self.cache = self.root / "PRIVATE cache"
        (self.app / "helper").mkdir(parents=True)
        (self.app / "extension").mkdir()
        self.settings = {"schema": 1, "enabled": True, "owner": "example", "repository": "example", "channel": "stable", "publicKeyXml": self.material["public"]}
        for name in ("helper", "extension"):
            (self.app / name / "update-config.json").write_text(json.dumps(self.settings), encoding="utf-8")
        (self.app / "extension/manifest.json").write_text('{"version":"1.34.0"}', encoding="utf-8")
        self.raw = b'{"schema":1,"version":"1.35.0","files":{}}'
        self.signature = self.material["signature"].encode("ascii")

    def tearDown(self):
        self.temp.cleanup()

    def snapshot(self):
        return {str(p.relative_to(self.root)): (p.stat().st_mtime_ns, p.read_bytes()) for p in self.root.rglob("*") if p.is_file()}

    def cache_pair(self, raw=None, signature=None):
        updater.remember_diagnostic_metadata(self.cache, self.app, self.settings, raw or self.raw, signature or self.signature)

    def assert_private_absent(self, result):
        serialized = json.dumps(result)
        for secret in ("SECRET", "PRIVATE", str(self.app), self.material["public"], "rawBase64", "signatureBase64"):
            self.assertNotIn(secret, serialized)
        self.assertLess(len(serialized), 12 * 1024)

    @unittest.skipUnless(os.name == "nt", "Real Windows providers")
    def test_one_read_only_offline_export_checks_native_verifier_without_shell(self):
        self.cache_pair()
        before = self.snapshot()
        with patch.object(support, "_published_material", side_effect=AssertionError("No network on cache hit")):
            result = support.collect(self.cache, self.app, allow_network=False)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["metadata"]["source"], "last_update_check")
        self.assertEqual(result["metadata"]["declaredVersion"], "1.35.0")
        self.assertEqual(result["providers"]["windowsCng"]["result"], "valid")
        self.assertEqual(result["providers"]["legacyCsp"]["result"], "not_used")
        self.assertTrue(result["configuration"]["helperAndExtensionKeyMatch"])
        self.assertEqual(self.snapshot(), before)
        self.assert_private_absent(result)

    @unittest.skipUnless(os.name == "nt", "Real Windows providers")
    def test_tampering_is_mismatch_and_runtime_failure_stays_distinct(self):
        self.cache_pair(raw=self.raw + b" ")
        result = support.collect(self.cache, self.app, allow_network=False)
        self.assertEqual(result["providers"]["windowsCng"]["result"], "mismatch")
        self.assertEqual(result["providers"]["legacyCsp"]["result"], "not_used")
        invalid = {**self.settings, "publicKeyXml": "<RSAKeyValue><Modulus>" + "!" * 120 + "</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>"}
        (self.app / "helper/update-config.json").write_text(json.dumps(invalid), encoding="utf-8")
        result = support.collect(self.cache, self.app, allow_network=False)
        self.assertEqual(result["providers"]["windowsCng"]["result"], "runtime_error")
        self.assertEqual(result["providers"]["legacyCsp"]["result"], "not_used")
        self.assertFalse(result["configuration"]["helperAndExtensionKeyMatch"])
        self.assertFalse(result["metadata"]["capturedKeyMatchesCurrent"])
        self.assert_private_absent(result)

    def test_no_cache_or_connection_gives_actionable_partial_export(self):
        with patch.object(support, "_published_material", side_effect=AssertionError("Network disabled")):
            result = support.collect(self.cache, self.app, allow_network=False)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["metadata"]["reason"], "no_cached_metadata_network_disabled")
        self.assertFalse(self.cache.exists())
        self.assert_private_absent(result)

    def test_explicit_network_probe_fetches_only_fixed_signed_metadata(self):
        prefix = "https://github.com/example/example/releases/download/v1.35.0/"
        api = {"draft": False, "prerelease": False, "assets": [{"name": name, "browser_download_url": prefix + name} for name in ("update-manifest.json", "update-manifest.sig", "application.zip")]}
        requested = []
        def fetch(url, maximum, deadline):
            requested.append(url)
            if url.endswith("/latest"):
                return json.dumps(api).encode()
            return self.raw if url.endswith(".json") else self.signature
        with patch.object(support, "_download", side_effect=fetch), patch.object(support, "_cng_probe", return_value={"result": "valid"}):
            result = support.collect(self.cache, self.app)
        self.assertEqual(len(requested), 3)
        self.assertFalse(any("application.zip" in url for url in requested))
        self.assertEqual(result["metadata"]["source"], "public_github_metadata")
        self.assertFalse(self.cache.exists(), "Export itself must not write the diagnostic cache")
        self.assert_private_absent(result)
        api["assets"][0]["browser_download_url"] = "https://unexpected.example/metadata"
        with patch.object(support, "_download", side_effect=fetch):
            rejected = support.collect(self.cache, self.app)
        self.assertEqual(rejected["status"], "partial")
        self.assertEqual(rejected["metadata"]["reason"], "metadata_fetch_failed")

    def test_hard_deadline_preserves_collected_configuration_and_never_changes_files(self):
        before = self.snapshot()
        def stalled(*_):
            time.sleep(.2)
            raise TimeoutError()
        started = time.monotonic()
        with patch.object(support, "_published_material", side_effect=stalled):
            result = support.collect(self.cache, self.app, deadline=time.monotonic() + .03)
            time.sleep(.22)  # Let the read-only daemon finish before fixture cleanup.
        self.assertLess(result["elapsedMilliseconds"], 180)
        self.assertLess(time.monotonic() - started, .4)
        self.assertEqual(result["reason"], "overall_deadline_exceeded")
        self.assertIn("trustedKeySha256", result["configuration"])
        self.assertEqual(self.snapshot(), before)
        self.assert_private_absent(result)

    def test_normal_update_check_retains_pair_even_when_verification_fails(self):
        prefix = "https://github.com/example/example/releases/download/v1.35.0/"
        release = {"draft": False, "prerelease": False, "assets": [{"name": name, "browser_download_url": prefix + name} for name in ("update-manifest.json", "update-manifest.sig")]}
        failure = updater.SignatureVerificationError("fixture", "signature_runtime_error", {"exitCode": 3})
        with patch.object(updater, "download", side_effect=[self.raw, self.signature]), patch.object(updater, "verify_signature", side_effect=failure):
            with self.assertRaises(updater.SignatureVerificationError):
                updater._check(self.cache, "1.17.0", self.app)
        stored = updater.read_json(updater.update_root(self.cache, self.app) / "diagnostic-metadata.json")
        self.assertEqual(base64.b64decode(stored["rawBase64"]), self.raw)
        self.assertEqual(base64.b64decode(stored["signatureBase64"]), self.signature)
        with patch.object(updater, "atomic_json", side_effect=PermissionError("SECRET location")):
            self.assertIsNone(updater.remember_diagnostic_metadata(self.cache, self.app, self.settings, self.raw, self.signature))

    def test_saved_transaction_is_available_to_older_installs_without_network(self):
        stage = updater.update_root(self.cache, self.app) / ("stage-" + "a" * 32)
        stage.mkdir(parents=True)
        (stage / "update-manifest.json").write_bytes(self.raw)
        (stage / "update-manifest.sig").write_bytes(self.signature)
        before = self.snapshot()
        with patch.object(support, "_cng_probe", return_value={"result": "valid"}):
            result = support.collect(self.cache, self.app, allow_network=False)
        self.assertEqual(result["metadata"]["source"], "retained_update_transaction")
        self.assertEqual(before, self.snapshot())
        self.assert_private_absent(result)

    @unittest.skipUnless(os.name == "nt", "Windows-only native verification")
    def test_export_never_starts_powershell_or_other_child_process(self):
        self.cache_pair()
        with patch.object(updater.subprocess, "run", side_effect=AssertionError("Shell verification forbidden")), patch.object(updater.subprocess, "Popen", side_effect=AssertionError("Child process forbidden")):
            result = support.collect(self.cache, self.app, allow_network=False)
        self.assertEqual(result["providers"]["windowsCng"]["result"], "valid")
        self.assertEqual(result["providers"]["legacyCsp"]["reason"], "external_powershell_verifiers_removed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
