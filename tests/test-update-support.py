"""Separate support probe never executes installed code or changes installation."""
from pathlib import Path
import ast
import base64
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("check_update_support", ROOT / "tools/support/check_update.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class UpdateSupportTests(unittest.TestCase):
    public = "<RSAKeyValue><Modulus>" + "a" * 120 + "</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>"

    def installed(self, root):
        helper = root / "SECRET local profile ü" / "helper"
        helper.mkdir(parents=True)
        (helper / "native_host.py").write_text('HOST_VERSION = "1.16.0"\nraise RuntimeError("Installed code must never execute")', encoding="utf-8")
        (helper / "updater.py").write_text("def verify_signature():\n script = " + repr(probe.LEGACY_SCRIPT), encoding="utf-8")
        settings = {"schema": 1, "enabled": True, "owner": probe.OWNER, "repository": probe.REPOSITORY,
                    "channel": "stable", "publicKeyXml": self.public}
        (helper / "update-config.json").write_text(json.dumps(settings), encoding="utf-8")
        extension = helper.parent / "extension"
        extension.mkdir()
        (extension / "manifest.json").write_text('{"version":"1.34.0"}', encoding="utf-8")
        return helper

    def test_reads_bounded_installed_files_without_importing_them_or_exporting_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            helper = self.installed(Path(temporary))
            before = {p: p.read_bytes() for p in Path(temporary).rglob("*") if p.is_file()}
            settings, info = probe.installed_info(helper.parent)
            self.assertEqual(info["helperVersion"], "1.16.0")
            self.assertEqual(info["extensionVersion"], "1.34.0")
            self.assertTrue(info["installedVerifierMatchesLegacy"])
            self.assertFalse(info["trustedKeyMatchesPublished"])
            self.assertNotIn("SECRET", json.dumps(info))
            self.assertNotIn(self.public, json.dumps(info))
            self.assertEqual(before, {p: p.read_bytes() for p in Path(temporary).rglob("*") if p.is_file()})
            path = helper / "update-config.json"
            path.write_text(json.dumps({**settings, "publicKeyXml": self.public.replace("</RSAKeyValue>", "<D>private</D></RSAKeyValue>")}), encoding="utf-8")
            with self.assertRaisesRegex(probe.ProbeError, "publisher_public_key_invalid"):
                probe.installed_info(helper)

    def test_registry_discovery_reads_exact_launcher_as_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            helper = self.installed(root)
            native = root / "native"
            native.mkdir()
            launcher = native / "host.cmd"
            launcher.write_text('@echo off\n"C:\\fixture\\python.exe" -u "' + str(helper / "native_host.py") + '"\n', encoding="utf-8")
            manifest = native / "host.json"
            manifest.write_text(json.dumps({"name": probe.HOST, "type": "stdio", "path": str(launcher), "allowed_origins": ["chrome-extension://SECRET/"]}), encoding="utf-8")
            class Key:
                def __enter__(self): return self
                def __exit__(self, *_): pass
            calls = []
            registry = types.SimpleNamespace(HKEY_CURRENT_USER=1, HKEY_LOCAL_MACHINE=2, KEY_WOW64_32KEY=4, KEY_WOW64_64KEY=8,
                                             KEY_READ=16, REG_SZ=1, REG_EXPAND_SZ=2,
                                             OpenKey=lambda *args: (calls.append(args) or Key()), QueryValueEx=lambda *_: (str(manifest), 1))
            with patch.dict(sys.modules, {"winreg": registry}):
                found, registration = probe.registered_helper()
            self.assertEqual(found, helper)
            self.assertEqual(registration, {"source": "registry_hkcu_brave_32", "allowedExtensionCount": 1})
            self.assertEqual(len(calls), 1)
            self.assertNotIn("SECRET", json.dumps(registration))

    def test_only_public_signed_metadata_from_expected_github_release_is_downloaded(self):
        good = "https://github.com/" + probe.OWNER + "/" + probe.REPOSITORY + "/releases/download/v1/"
        for bad in ("http://github.com/" + probe.OWNER + "/" + probe.REPOSITORY + "/releases/download/v1/file", good.replace("github.com/", "github.com.evil/"), good + "../secret", good.replace(probe.OWNER, "someone-else"), good.replace("https://", "https://user:password@")):
            with self.assertRaises(probe.ProbeError):
                probe.asset_url(bad)
        release = {"draft": False, "prerelease": False, "assets": [{"name": name, "browser_download_url": good + name} for name in ("update-manifest.json", "update-manifest.sig", "extension.zip")]}
        signature = b"s" * 384
        with patch.object(probe, "download", side_effect=[json.dumps(release).encode(), b"signed bytes", base64.b64encode(signature)]) as fetch:
            self.assertEqual(probe.published_material(), (b"signed bytes", signature))
        self.assertEqual(len(fetch.call_args_list), 3)
        self.assertFalse(any("extension.zip" in call.args[0] for call in fetch.call_args_list))
        release["assets"].append(release["assets"][0])
        with patch.object(probe, "download", return_value=json.dumps(release).encode()):
            with self.assertRaisesRegex(probe.ProbeError, "duplicate_release_asset"):
                probe.published_material()

    @unittest.skipUnless(os.name == "nt", "Windows verifier protocol")
    def test_verifier_reports_classified_facts_without_raw_outputs(self):
        detail = {"step": "verify", "exceptionType": "System.Security.Cryptography.CryptographicException", "hresult": -2146893818,
                  "powershellVersion": "5.1.2", "languageMode": "FullLanguage", "message": "SECRET request", "path": "SECRET local profile"}
        completed = subprocess.CompletedProcess([], 3, json.dumps(detail).encode(), b"SECRET stderr")
        with patch.object(probe.subprocess, "run", return_value=completed):
            result = probe.windows_probe("not executed", b"SECRET payload")
        self.assertEqual(result["result"], "runtime_error")
        self.assertEqual(result["hresult"], -2146893818)
        self.assertNotIn("SECRET", json.dumps(result))
        for returncode, stdout, expected in ((0, b"VALID", "valid"), (2, b"", "mismatch"), (2, b"INVALID", "mismatch"), (0, b"VALID extra", "unexpected_output")):
            with patch.object(probe.subprocess, "run", return_value=subprocess.CompletedProcess([], returncode, stdout, b"SECRET stderr")):
                self.assertEqual(probe.windows_probe("", b"")["result"], expected)

    @unittest.skipUnless(os.name == "nt", "Windows-only collection")
    def test_complete_report_keeps_installation_unchanged_and_runs_legacy_detail_only_on_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            helper = self.installed(root)
            before = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
            with patch.object(probe, "published_material", return_value=(b"public signed metadata", b"s" * 384)), patch.object(probe, "windows_probe", side_effect=[{"result": "runtime_error", "exitCode": 3}, {"result": "valid", "exitCode": 0}, {"result": "runtime_error", "hresult": -1}]) as verify:
                report = probe.collect(helper)
            self.assertEqual(len(verify.call_args_list), 3)
            self.assertEqual(report["verification"]["cng"]["result"], "valid")
            self.assertNotIn("SECRET", json.dumps(report))
            self.assertNotIn(self.public, json.dumps(report))
            self.assertEqual(before, {p: p.read_bytes() for p in root.rglob("*") if p.is_file()})


if __name__ == "__main__":
    unittest.main(verbosity=2)
