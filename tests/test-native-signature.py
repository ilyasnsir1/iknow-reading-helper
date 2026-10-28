"""Native Windows RSA verification is fail closed and never starts a child process."""
from pathlib import Path
import base64
import ctypes
import hashlib
import json
import os
import struct
import subprocess
import sys
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "helper"))
import updater


class NativeFunction:
    """Callable whose ctypes ABI declarations can be assigned by production code."""
    def __init__(self, callback):
        self.callback = callback

    def __call__(self, *args):
        return self.callback(*args)


class FakeBcrypt:
    def __init__(self, *, provider=0, import_key=0, verify=0):
        self.statuses = provider, import_key, verify
        self.closed, self.destroyed, self.seen = [], [], {}
        self.BCryptOpenAlgorithmProvider = NativeFunction(self.open)
        self.BCryptImportKeyPair = NativeFunction(self.import_key)
        self.BCryptVerifySignature = NativeFunction(self.verify)
        self.BCryptDestroyKey = NativeFunction(self.destroy)
        self.BCryptCloseAlgorithmProvider = NativeFunction(self.close)

    @staticmethod
    def status(value):
        return ctypes.c_int32(value).value

    @staticmethod
    def handle(value):
        return value.value if isinstance(value, ctypes.c_void_p) else value

    def open(self, output, algorithm, implementation, flags):
        self.seen["algorithm"] = algorithm
        self.seen["providerFlags"] = flags
        if not self.statuses[0]:
            ctypes.cast(output, ctypes.POINTER(ctypes.c_void_p))[0] = ctypes.c_void_p(101)
        return self.status(self.statuses[0])

    def import_key(self, algorithm, unused, kind, output, blob, size, flags):
        self.seen.update(blobType=kind, blob=ctypes.string_at(blob, size), importFlags=flags)
        if not self.statuses[1]:
            ctypes.cast(output, ctypes.POINTER(ctypes.c_void_p))[0] = ctypes.c_void_p(202)
        return self.status(self.statuses[1])

    def verify(self, key, padding, digest, digest_size, signature, signature_size, flags):
        self.seen.update(digest=ctypes.string_at(digest, digest_size),
                         signature=ctypes.string_at(signature, signature_size), verifyFlags=flags)
        self.seen["paddingAlgorithm"] = ctypes.cast(padding, ctypes.POINTER(ctypes.c_wchar_p))[0]
        return self.status(self.statuses[2])

    def destroy(self, key):
        self.destroyed.append(self.handle(key))
        return 0

    def close(self, algorithm, flags):
        self.closed.append(self.handle(algorithm))
        return 0


@unittest.skipUnless(os.name == "nt", "Windows bcrypt ABI")
class NativeSignatureTests(unittest.TestCase):
    raw = b'{"signed":"native RSA test metadata"}\n'

    @classmethod
    def setUpClass(cls):
        # Test setup only: generate a disposable signing key, never read the
        # publisher private key. Production verification below forbids children.
        payload = base64.b64encode(cls.raw).decode("ascii")
        script = (
            "$ErrorActionPreference='Stop';"
            "$a=New-Object Security.Cryptography.RSACryptoServiceProvider(2048);"
            "$b=New-Object Security.Cryptography.RSACryptoServiceProvider(2048);"
            "$a.PersistKeyInCsp=$false;$b.PersistKeyInCsp=$false;"
            "try{@{public=$a.ToXmlString($false);wrong=$b.ToXmlString($false);"
            "signature=[Convert]::ToBase64String($a.SignData([Convert]::FromBase64String('" + payload + "'),'SHA256'))}"
            "|ConvertTo-Json -Compress}finally{$a.Dispose();$b.Dispose()}"
        )
        result = subprocess.run(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
                                capture_output=True, check=True, timeout=30,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        material = json.loads(result.stdout)
        cls.public, cls.wrong = material["public"], material["wrong"]
        cls.signature = material["signature"].encode("ascii")

    def no_children(self):
        return patch.multiple(subprocess, run=unittest.mock.DEFAULT, Popen=unittest.mock.DEFAULT)

    def test_real_native_verification_accepts_legacy_signature_without_children(self):
        with self.no_children() as children:
            for child in children.values():
                child.side_effect = AssertionError("Verification launched a child process")
            updater.verify_signature(self.raw, self.signature + b"\n", self.public)
            for raw, key in ((self.raw + b" ", self.public), (self.raw, self.wrong)):
                with self.assertRaises(updater.SignatureVerificationError) as raised:
                    updater.verify_signature(raw, self.signature, key)
                self.assertEqual(raised.exception.code, "signature_mismatch")
            for child in children.values():
                child.assert_not_called()

    def test_rsa_blob_uses_little_endian_header_and_big_endian_key_values(self):
        xml = ET.fromstring(self.public)
        exponent = base64.b64decode(xml.findtext("Exponent"), validate=True)
        modulus = base64.b64decode(xml.findtext("Modulus"), validate=True)
        blob = updater._rsa_public_blob(self.public)
        self.assertEqual(struct.unpack("<6I", blob[:24]),
                         (0x31415352, len(modulus) * 8, len(exponent), len(modulus), 0, 0))
        self.assertEqual(blob[24:], exponent + modulus)

    def test_key_parser_rejects_malformed_extra_and_private_material(self):
        invalid = ["", "<RSAKeyValue>", "<Other/>",
                   "x" * 8192,
                   '<!DOCTYPE RSAKeyValue [<!ENTITY x "AQAB">]>' + self.public,
                   self.public.replace("<Exponent>AQAB</Exponent>", "<Exponent>bad!</Exponent>"),
                   self.public.replace("<Exponent>AQAB</Exponent>", "<Exponent>Ag==</Exponent>"),
                   self.public.replace("<Exponent>AQAB</Exponent>", "<Exponent>AAEAAQ==</Exponent>"),
                   self.public.replace("<Exponent>AQAB</Exponent>", "<Exponent><X>AQAB</X></Exponent>"),
                   self.public.replace("</RSAKeyValue>", "<D>AQAB</D></RSAKeyValue>"),
                   self.public.replace("</RSAKeyValue>", "<Exponent>AQAB</Exponent></RSAKeyValue>"),
                   self.public.replace("<RSAKeyValue>", '<RSAKeyValue arbitrary="value">'),
                   "<RSAKeyValue><Modulus>AQAB</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>"]
        for key in invalid:
            with self.subTest(key=key[:60]), self.assertRaises(updater.SignatureVerificationError) as raised:
                updater.verify_signature(self.raw, self.signature, key)
            self.assertEqual(raised.exception.code, "signature_runtime_error")
            self.assertEqual(raised.exception.verification["step"], "key")

    def test_invalid_signature_encoding_or_length_never_reaches_native_api(self):
        for signature in (b"bad!base64", base64.b64encode(b"x" * 255), base64.b64encode(b"x" * 513)):
            with self.subTest(length=len(signature)), patch.object(ctypes, "WinDLL") as load:
                with self.assertRaises(updater.UpdateError):
                    updater.verify_signature(self.raw, signature, self.public)
                load.assert_not_called()

    def test_abi_hash_padding_and_success_handle_cleanup(self):
        dll = FakeBcrypt()
        with patch.object(ctypes, "WinDLL", return_value=dll) as load:
            updater.verify_signature(self.raw, self.signature, self.public)
        load.assert_called_once_with("bcrypt.dll", winmode=0x800)
        self.assertEqual(dll.seen["algorithm"], "RSA")
        self.assertEqual(dll.seen["blobType"], "RSAPUBLICBLOB")
        self.assertEqual(dll.seen["providerFlags"], 0)
        self.assertEqual(dll.seen["importFlags"], 0)
        self.assertEqual(dll.seen["verifyFlags"], 2)
        self.assertEqual(dll.seen["paddingAlgorithm"], "SHA256")
        self.assertEqual(dll.seen["digest"], hashlib.sha256(self.raw).digest())
        self.assertEqual(dll.seen["signature"], base64.b64decode(self.signature))
        self.assertEqual(dll.destroyed, [202])
        self.assertEqual(dll.closed, [101])
        for function in (dll.BCryptOpenAlgorithmProvider, dll.BCryptImportKeyPair, dll.BCryptVerifySignature,
                         dll.BCryptDestroyKey, dll.BCryptCloseAlgorithmProvider):
            self.assertTrue(function.argtypes)
            self.assertEqual(ctypes.sizeof(function.restype), 4)

    def test_only_invalid_signature_is_mismatch_and_all_paths_release_handles(self):
        for field, status, code, step, destroyed, closed in (
                ("provider", 0xC0000008, "signature_runtime_error", "provider", [], []),
                ("import_key", 0xC000000D, "signature_runtime_error", "import", [], [101]),
                ("verify", 0xC000000D, "signature_runtime_error", "verify", [202], [101]),
                ("verify", 0xC000A000, "signature_mismatch", "verify", [202], [101])):
            dll = FakeBcrypt(**{field: status})
            with self.subTest(field=field, status=hex(status)), patch.object(ctypes, "WinDLL", return_value=dll):
                with self.assertRaises(updater.SignatureVerificationError) as raised:
                    updater.verify_signature(self.raw, self.signature, self.public)
                self.assertEqual(raised.exception.code, code)
                self.assertEqual(raised.exception.verification["provider"], "windows-bcrypt")
                self.assertEqual(raised.exception.verification["step"], step)
                self.assertEqual(raised.exception.verification["ntstatus"], status)
                self.assertEqual(dll.destroyed, destroyed)
                self.assertEqual(dll.closed, closed)

    def test_library_failure_is_safe_unavailable_error(self):
        with patch.object(ctypes, "WinDLL", side_effect=OSError("PRIVATE filesystem details")):
            with self.assertRaises(updater.SignatureVerificationError) as raised:
                updater.verify_signature(self.raw, self.signature, self.public)
        self.assertEqual(raised.exception.code, "signature_verifier_unavailable")
        self.assertNotIn("PRIVATE", json.dumps(raised.exception.verification))
        self.assertNotIn("PRIVATE", str(raised.exception))

    def test_previously_published_manifest_verifies_using_same_pinned_key(self):
        published = ROOT.parents[1] / "outputs/releases/1.35.0/github"
        if not published.is_dir():
            self.skipTest("Local earlier release fixture is not available")
        public = json.loads((ROOT / "helper/update-config.json").read_text(encoding="utf-8"))["publicKeyXml"]
        with self.no_children() as children:
            for child in children.values():
                child.side_effect = AssertionError("Verification launched a child process")
            updater.verify_signature((published / "update-manifest.json").read_bytes(),
                                     (published / "update-manifest.sig").read_bytes(), public)


if __name__ == "__main__":
    unittest.main(verbosity=2)
