"""Bounded signed discovery, without GitHub REST or any installed application.

Uses the existing isolated RSA test fixture for temporary test keys. Network
transport is controlled; Windows CNG still verifies the real signed bytes.
"""
from pathlib import Path
import base64
import copy
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "helper"))
import updater

spec = importlib.util.spec_from_file_location("isolated_update_rsa_fixture", Path(__file__).with_name("test-updater-helper.py"))
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)


@unittest.skipUnless(os.name == "nt", "Real Windows publisher verification")
class FastDiscoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        legacy.UpdaterTests.setUpClass()

    @classmethod
    def tearDownClass(cls):
        legacy.UpdaterTests.tearDownClass()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="iknow-fast-discovery-")
        self.root = Path(self.directory.name)
        self.app, self.cache = self.root / "application", self.root / "cache"
        (self.app / "extension").mkdir(parents=True)
        (self.app / "helper").mkdir()
        (self.app / "extension/manifest.json").write_text('{"version":"1.37.0"}', encoding="utf-8")
        self.settings = copy.deepcopy(legacy.UpdaterTests.settings)
        (self.app / "helper/update-config.json").write_text(json.dumps(self.settings), encoding="utf-8")
        self.prefix = "https://github.com/" + self.settings["owner"] + "/" + self.settings["repository"]
        self.clock = patch.object(updater.time, "time", return_value=1800000000)
        self.clock_mock = self.clock.start()
        self.addCleanup(self.clock.stop)
        self.latest_base = self.prefix + "/releases/latest/download/update-manifest.json"
        self.latest = self.latest_base + "?ikr_check=40000000"
        self.signature_url = self.prefix + "/releases/download/v1.38.0/update-manifest.sig"
        self.manifest = {"schema": 1, "version": "1.38.0", "helperVersion": "1.21.0", "minimumHelperVersion": "1.16.0",
                         "asset": {"name": "Reading-Helper-1.38.0.zip", "size": 12345, "sha256": "a" * 64,
                                   "url": self.prefix + "/releases/download/v1.38.0/Reading-Helper-1.38.0.zip"},
                         "files": {name: "b" * 64 for name in ["extension/manifest.json", "helper/native_host.py", "RELEASE-FILES.json"]}}
        self.raw = json.dumps(self.manifest, indent=2).encode()
        self.signature = self.sign(self.raw)
        self.requests = []

    def tearDown(self):
        self.directory.cleanup()

    @staticmethod
    def sign(raw):
        return legacy.UpdaterTests().sign(raw)

    def transport(self, url, limit, target=None, progress=None):
        self.assertIsNone(target, "Discovery must never fetch an archive")
        self.requests.append((url, limit))
        if url == self.latest:
            return self.raw
        if url == self.signature_url:
            return self.signature
        self.fail("Unexpected discovery request: " + url)

    def remember(self, raw, signature):
        updater.remember_diagnostic_metadata(self.cache, self.app, self.settings, raw, signature)

    @property
    def metadata_cache(self):
        return updater.update_root(self.cache, self.app) / "diagnostic-metadata.json"

    def check(self):
        return updater.get_latest_release(self.settings, "1.37.0", "1.21.0", cache=self.cache,
                                          app_root=self.app, on_metadata=self.remember)

    def test_01_exact_latest_endpoint_only(self):
        self.assertEqual(updater.safe_url(self.latest, self.settings, latest_metadata=True), self.latest)
        self.assertEqual(updater.safe_url(self.latest_base, self.settings, latest_metadata=True), self.latest_base)
        with self.assertRaises(updater.UpdateError):
            updater.safe_url(self.latest, self.settings)
        for candidate in [self.latest + "&elsewhere=1", self.latest + "&ikr_check=2", self.latest_base + "?ikr_check=-1",
                          self.latest_base + "?ikr_check=01", self.latest_base + "?ikr_check=1.2", self.latest_base + "?ikr_check=" + "1" * 13,
                          self.latest_base + "/extra", self.latest.replace("update-manifest.json", "update.zip"),
                          self.latest.replace("github.com/", "github.com.evil.test/"), self.latest.replace("https:", "http:"),
                          self.latest.replace("/" + self.settings["owner"] + "/", "/another-owner/")]:
            with self.assertRaises(updater.UpdateError, msg=candidate):
                updater.safe_url(candidate, self.settings, latest_metadata=True)

    def test_02_signed_first_probe_without_rest_or_archive(self):
        with patch.object(updater, "download", side_effect=self.transport), patch.object(updater, "verify_signature", wraps=updater.verify_signature) as verify:
            manifest, raw, signature = self.check()
        self.assertEqual(manifest, self.manifest)
        self.assertEqual((raw, signature), (self.raw, self.signature))
        self.assertEqual([url for url, _ in self.requests], [self.latest, self.signature_url])
        self.assertEqual(verify.call_count, 1)
        self.assertTrue(self.metadata_cache.is_file())
        self.assertFalse(any(name in sys.modules for name in ["numpy", "torch", "faster_whisper", "neural_speech"]))

    def test_03_unchanged_raw_reuses_only_signature_and_reverifies(self):
        with patch.object(updater, "download", side_effect=self.transport):
            self.check()
        self.requests.clear()
        with patch.object(updater, "download", side_effect=self.transport), patch.object(updater, "verify_signature", wraps=updater.verify_signature) as verify:
            self.check()
        self.assertEqual([url for url, _ in self.requests], [self.latest])
        self.assertEqual(verify.call_count, 1)
        verify.assert_called_once_with(self.raw, self.signature, self.settings["publicKeyXml"])

    def test_04_support_cache_binding_and_bounded_reads(self):
        self.remember(self.raw, self.signature)
        original = json.loads(self.metadata_cache.read_bytes())
        variants = [{**original, "owner": "foreign"}, {**original, "repository": "foreign"},
                    {**original, "trustedKeySha256": "c" * 64}, {**original, "rawBase64": base64.b64encode(self.raw + b" ").decode()},
                    {**original, "signatureBase64": "!"}]
        for value in variants:
            self.metadata_cache.write_text(json.dumps(value), encoding="utf-8")
            self.requests.clear()
            with patch.object(updater, "download", side_effect=self.transport):
                self.check()
            self.assertEqual(len(self.requests), 2)
        for raw in [b"{bad-json", b"[" * 20000 + b"]" * 20000, b" " * (768 * 1024 + 1)]:
            self.metadata_cache.write_bytes(raw)
            self.requests.clear()
            with patch.object(updater, "download", side_effect=self.transport):
                self.check()
            self.assertEqual(len(self.requests), 2)

    def test_05_bad_cached_signature_refetches_and_fresh_tampering_fails_closed(self):
        self.remember(self.raw, b"A" * len(self.signature))
        with patch.object(updater, "download", side_effect=self.transport), patch.object(updater, "verify_signature", wraps=updater.verify_signature) as verify:
            self.check()
        self.assertEqual(len(self.requests), 2)
        self.assertEqual(verify.call_count, 2)
        self.raw += b" "
        with patch.object(updater, "download", side_effect=self.transport), self.assertRaises(updater.SignatureVerificationError):
            self.check()

    def test_06_signed_version_archive_and_helper_rules_are_rechecked(self):
        for mutate in [lambda value: value["asset"].update(url=self.prefix + "/releases/download/v1.39.0/Reading-Helper-1.38.0.zip"),
                       lambda value: value.update(minimumHelperVersion="9.0.0"),
                       lambda value: value["asset"].update(url="https://github.com/foreign/repo/releases/download/v1.38.0/archive.zip")]:
            value = copy.deepcopy(self.manifest)
            mutate(value)
            self.raw = json.dumps(value).encode()
            self.signature = self.sign(self.raw)
            with patch.object(updater, "download", side_effect=self.transport), self.assertRaises(updater.UpdateError):
                self.check()
        self.raw = json.dumps(self.manifest).encode()
        self.signature = self.sign(self.raw)
        with patch.object(updater, "download", side_effect=self.transport):
            stale, _, _ = updater.get_latest_release(self.settings, "1.39.0", "1.21.0", cache=self.cache, app_root=self.app)
        self.assertEqual(stale["version"], "1.38.0")
        with self.assertRaises(updater.UpdateError):
            updater.validate_manifest(self.raw, self.settings, "1.39.0", "1.21.0")
        self.raw = b'{"version":"1.38.0","version":"1.39.0"}'
        with patch.object(updater, "download", side_effect=self.transport), self.assertRaises(updater.UpdateError):
            self.check()

    def test_07_moving_metadata_requests_revalidate_redirect(self):
        seen = []
        class Response(io.BytesIO):
            headers = {"Content-Length": "4"}
        class Opener:
            def open(self, request, timeout):
                seen.append(dict(request.header_items()))
                return Response(b"demo")
        with patch.object(updater.urllib.request, "build_opener", return_value=Opener()):
            self.assertEqual(updater.download(self.latest, 512 * 1024), b"demo")
        self.assertEqual(seen[0]["Cache-control"], "no-cache, max-age=0")
        self.assertEqual(seen[0]["Pragma"], "no-cache")

    def test_08_normal_check_uses_fast_path_and_preserves_public_support_pair(self):
        with patch.object(updater, "download", side_effect=self.transport), patch.object(updater, "get_release", side_effect=AssertionError("REST path called")):
            first = updater._check(self.cache, "1.21.0", self.app)
            second = updater._check(self.cache, "1.21.0", self.app)
        self.assertEqual((first["status"], second["status"]), ("available", "available"))
        self.assertEqual(second["latestVersion"], "1.38.0")
        self.assertEqual([url for url, _ in self.requests], [self.latest, self.signature_url, self.latest])
        cached = json.loads(self.metadata_cache.read_bytes())
        self.assertEqual(base64.b64decode(cached["rawBase64"]), self.raw)

    def test_09_install_release_lookup_keeps_rest_membership_validation(self):
        api = "https://api.github.com/repos/" + self.settings["owner"] + "/" + self.settings["repository"] + "/releases/latest"
        metadata_url = self.prefix + "/releases/download/v1.38.0/update-manifest.json"
        release = {"draft": False, "prerelease": False, "assets": [
            {"name": "update-manifest.json", "browser_download_url": metadata_url},
            {"name": "update-manifest.sig", "browser_download_url": self.signature_url},
            {"name": self.manifest["asset"]["name"], "browser_download_url": self.manifest["asset"]["url"], "size": 12345}]}
        requests = []
        def transport(url, limit, target=None, progress=None):
            requests.append(url)
            return {api: json.dumps(release).encode(), metadata_url: self.raw, self.signature_url: self.signature}[url]
        with patch.object(updater, "download", side_effect=transport):
            updater.get_release(self.settings, "1.37.0", "1.21.0")
            release["assets"][-1]["size"] = 12346
            with self.assertRaises(updater.UpdateError):
                updater.get_release(self.settings, "1.37.0", "1.21.0")
        self.assertEqual(requests[:3], [api, metadata_url, self.signature_url])

    def test_10_stale_signed_metadata_is_not_a_downgrade_or_lost_notice(self):
        (self.app / "extension/manifest.json").write_text(json.dumps({"version": "1.39.0"}), encoding="utf-8")
        with patch.object(updater, "download", side_effect=self.transport):
            state = updater._check(self.cache, "1.21.1", self.app)
        self.assertEqual(state["status"], "current")
        self.assertEqual(state["latestVersion"], "1.39.0")
        self.assertEqual(state["metadataVersion"], "1.38.0")
        self.assertTrue(state["metadataStale"])
        updater.save_state(self.cache, {"status": "available", "latestVersion": "1.40.0"}, self.app)
        with patch.object(updater, "download", side_effect=self.transport):
            state = updater._check(self.cache, "1.21.1", self.app)
        self.assertEqual(state["status"], "available")
        self.assertEqual(state["latestVersion"], "1.40.0")
        self.assertTrue(state["metadataStale"])

    def test_11_time_bucket_changes_without_user_identifiers(self):
        with patch.object(updater, "download", side_effect=self.transport):
            self.check()
        self.clock_mock.return_value = 1800000045
        def next_transport(url, limit, target=None, progress=None):
            if url == self.latest_base + "?ikr_check=40000001":
                return self.raw
            return self.transport(url, limit, target, progress)
        with patch.object(updater, "download", side_effect=next_transport):
            self.check()


if __name__ == "__main__":
    unittest.main(verbosity=2)
