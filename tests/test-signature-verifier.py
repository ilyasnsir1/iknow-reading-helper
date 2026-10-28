"""Signature failures remain fail-closed and provide safe, useful support data."""
from pathlib import Path
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "helper"))
import updater
import diagnostics


class SignatureVerifierTests(unittest.TestCase):
    raw = b'{"schema":1,"public":"metadata"}'
    signature = base64.b64encode(b"s" * 384)
    key = "<RSAKeyValue><Modulus>public-only</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>"

    @unittest.skipUnless(os.name == "nt", "Windows verifier protocol")
    def test_mismatch_is_distinct_from_windows_runtime_failures(self):
        for failure, code in ((updater.NativeSignatureError("verify", 0xC000A000), "signature_mismatch"),
                              (updater.NativeSignatureError("provider", 0xC00000BB), "signature_runtime_error"),
                              (OSError("PRIVATE path"), "signature_verifier_unavailable")):
            with patch.object(updater, "_bcrypt_verify", side_effect=failure):
                with self.assertRaises(updater.SignatureVerificationError) as raised:
                    updater.verify_signature(self.raw, self.signature, self.key)
            self.assertEqual(raised.exception.code, code)
            self.assertEqual(raised.exception.verification["metadataSha256"], hashlib.sha256(self.raw).hexdigest())
            self.assertNotIn("PRIVATE", json.dumps(raised.exception.verification))

    @unittest.skipUnless(os.name == "nt", "Windows CNG verifier")
    def test_real_windows_cng_verifies_legacy_publisher_rsa_and_rejects_tampering(self):
        # A fresh disposable CSP signing key exercises compatibility with the
        # publisher algorithm; no personal signing key is read or exported.
        script = "$r=New-Object Security.Cryptography.RSACryptoServiceProvider(2048);$r.PersistKeyInCsp=$false;$raw=[Text.Encoding]::UTF8.GetBytes('test metadata');@{public=$r.ToXmlString($false);signature=[Convert]::ToBase64String($r.SignData($raw,'SHA256'))}|ConvertTo-Json -Compress;$r.Dispose()"
        encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
        signed = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                                capture_output=True, check=True, timeout=25, creationflags=subprocess.CREATE_NO_WINDOW)
        material = json.loads(signed.stdout)
        raw, signature, key = b"test metadata", material["signature"].encode(), material["public"]
        updater.verify_signature(raw, signature, key)
        with self.assertRaises(updater.SignatureVerificationError) as raised:
            updater.verify_signature(raw + b" ", signature, key)
        self.assertEqual(raised.exception.code, "signature_mismatch")
        with self.assertRaises(updater.SignatureVerificationError) as raised:
            updater.verify_signature(raw, signature, "<RSAKeyValue><Modulus>bad!</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>")
        self.assertEqual(raised.exception.code, "signature_runtime_error")
        self.assertEqual(raised.exception.verification["step"], "key")

    def test_diagnostic_snapshot_is_read_only_bounded_and_public_only(self):
        with tempfile.TemporaryDirectory(prefix="iknow-signature-diagnostic-") as temporary:
            base = Path(temporary)
            app, cache = base / "app", base / "cache"
            (app / "helper").mkdir(parents=True)
            settings = {"schema": 1, "enabled": True, "owner": "example", "repository": "example", "channel": "stable", "publicKeyXml": self.key + " " * 100}
            (app / "helper/update-config.json").write_text(json.dumps(settings), encoding="utf-8")
            self.assertFalse(cache.exists())
            first = updater.diagnostic_snapshot(cache, app)
            self.assertFalse(cache.exists())
            self.assertEqual(first["trustedKeySha256"], hashlib.sha256(settings["publicKeyXml"].encode()).hexdigest())
            state = updater.state_path(cache, app)
            updater.atomic_json(state, {"status": "error", "message": "PRIVATE unstructured message", "verification": {
                "code": "signature_runtime_error", "provider": "windows-cng", "step": "verify", "exitCode": 3,
                "trustedKeySha256": "a" * 64, "metadataSha256": "b" * 64, "signatureSha256": "c" * 64,
                "hresult": -2146893802, "exceptionType": "PRIVATE/path!", "powershellVersion": "5.1.2",
                "languageMode": "FullLanguage", "publicKeyXml": "PRIVATE key", "stderr": "PRIVATE log", "path": "PRIVATE path"}})
            before = {p: (p.stat().st_mtime_ns, p.read_bytes()) for p in base.rglob("*") if p.is_file()}
            result = updater.diagnostic_snapshot(cache, app)
            self.assertNotIn("PRIVATE", json.dumps(result))
            self.assertEqual(result["verification"]["code"], "signature_runtime_error")
            self.assertEqual(result["verification"]["exitCode"], 3)
            self.assertEqual({p: (p.stat().st_mtime_ns, p.read_bytes()) for p in base.rglob("*") if p.is_file()}, before)
            with patch.object(diagnostics.updater, "diagnostic_snapshot", return_value=result):
                report = diagnostics.collect(cache, "1.16.0")
            self.assertEqual(report["updates"], result)

    def test_native_update_failure_persists_safe_evidence_for_support(self):
        with tempfile.TemporaryDirectory(prefix="iknow-signature-state-") as temporary:
            replies, finished = [], threading.Event()
            failure = updater.SignatureVerificationError("Windows verification failed.", "signature_runtime_error", {
                "provider": "windows-cng", "metadataSha256": "a" * 64, "exitCode": 3})
            def send(reply):
                replies.append(reply)
                finished.set()
            with patch.object(updater, "_check", side_effect=failure):
                updater.handle({"type": "update:check", "requestId": "signature-test"}, Path(temporary), send, "1.16.0")
                self.assertTrue(finished.wait(5))
            self.assertFalse(replies[0]["ok"])
            saved = updater.diagnostic_snapshot(Path(temporary))
            self.assertEqual(saved["verification"]["code"], "signature_runtime_error")
            self.assertNotIn("signature", replies[0]["state"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
