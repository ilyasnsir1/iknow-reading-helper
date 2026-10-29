"""Explicit, signed updates for the unpacked Windows application.

Only code in the installed application may launch an update. Downloaded archives
are data until the pinned publisher signature, every digest and the managed-file
baseline have been checked. Models, browser storage and preparation caches are
outside the transaction. This module uses only the Python standard library and
the Windows RSA implementation already present on supported Windows systems.
"""
from __future__ import annotations

import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
import xml.etree.ElementTree as ET

APP_ROOT = Path(__file__).resolve().parent.parent
MAX_METADATA = 2 * 1024 * 1024
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_EXPANDED = 128 * 1024 * 1024
MAX_FILE = 32 * 1024 * 1024
MAX_FILES = 1500
HASH = re.compile(r"^[a-f0-9]{64}$")
ACTIVE = {"downloading", "installing"}
_threads = set()
_thread_lock = threading.Lock()


class UpdateError(ValueError):
    pass


class UpdateBusy(UpdateError):
    pass


class SignatureVerificationError(UpdateError):
    """Fail closed while retaining only public, bounded verification evidence."""
    def __init__(self, message, code, verification):
        super().__init__(message)
        self.code = code
        self.verification = {**verification, "code": code}


class NativeSignatureError(ValueError):
    """Only a Windows status and fixed operation name; no key/request data."""
    def __init__(self, stage, ntstatus):
        self.stage, self.ntstatus = stage, int(ntstatus) & 0xffffffff
        super().__init__("Windows public signature verification failed.")


def _rsa_public_blob(public_key):
    """Convert only a bounded RSA public key to the documented CNG blob."""
    if not isinstance(public_key, str) or not 100 < len(public_key) < 8192 or "<!" in public_key:
        raise ValueError("Invalid public key.")
    root = ET.fromstring(public_key)
    if root.tag != "RSAKeyValue" or root.attrib or len(root) != 2 or {item.tag for item in root} != {"Modulus", "Exponent"}:
        raise ValueError("Only the public modulus and exponent are supported.")
    parts = {}
    for item in root:
        if item.attrib or len(item) or not isinstance(item.text, str):
            raise ValueError("Invalid public key field.")
        parts[item.tag] = base64.b64decode(item.text.strip(), validate=True)
    modulus, exponent = parts["Modulus"], parts["Exponent"]
    if len(modulus) not in (256, 384, 512) or modulus[0] < 128 or not modulus[-1] & 1:
        raise ValueError("Unsupported RSA public modulus.")
    if not 1 <= len(exponent) <= 8 or exponent[0] == 0 or int.from_bytes(exponent, "big") < 3 or not exponent[-1] & 1:
        raise ValueError("Unsupported RSA public exponent.")
    # BCRYPT_RSAKEY_BLOB uses six little-endian ULONG fields, followed by
    # big-endian exponent and modulus bytes (BCRYPT_RSAPUBLIC_MAGIC = RSA1).
    return struct.pack("<6I", 0x31415352, len(modulus) * 8, len(exponent), len(modulus), 0, 0) + exponent + modulus


def _bcrypt_verify(public_key, raw, signature):
    """Use Windows CNG in this process. No shell, provider script or key store."""
    blob = _rsa_public_blob(public_key)
    modulus_bytes = struct.unpack("<6I", blob[:24])[3]
    if len(signature) != modulus_bytes:
        raise NativeSignatureError("verify", 0xC000A000)
    # Load only the operating system's DLL, never a DLL next to a downloaded
    # package. CNG validates the public key; no validation bypass is requested.
    library = ctypes.WinDLL("bcrypt.dll", winmode=0x00000800)
    handle, ulong, status = ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int32
    library.BCryptOpenAlgorithmProvider.argtypes = [ctypes.POINTER(handle), ctypes.c_wchar_p, ctypes.c_wchar_p, ulong]
    library.BCryptOpenAlgorithmProvider.restype = status
    library.BCryptImportKeyPair.argtypes = [handle, handle, ctypes.c_wchar_p, ctypes.POINTER(handle), ctypes.c_void_p, ulong, ulong]
    library.BCryptImportKeyPair.restype = status
    library.BCryptVerifySignature.argtypes = [handle, ctypes.c_void_p, ctypes.c_void_p, ulong, ctypes.c_void_p, ulong, ulong]
    library.BCryptVerifySignature.restype = status
    library.BCryptDestroyKey.argtypes = [handle]
    library.BCryptDestroyKey.restype = status
    library.BCryptCloseAlgorithmProvider.argtypes = [handle, ulong]
    library.BCryptCloseAlgorithmProvider.restype = status
    class Padding(ctypes.Structure):
        _fields_ = [("algorithm", ctypes.c_wchar_p)]
    algorithm, key = handle(), handle()
    def checked(result, stage):
        if result != 0:
            raise NativeSignatureError(stage, result)
    try:
        checked(library.BCryptOpenAlgorithmProvider(ctypes.byref(algorithm), "RSA", None, 0), "provider")
        if not algorithm.value:
            raise NativeSignatureError("provider", 0xC0000008)
        key_buffer = ctypes.create_string_buffer(blob)
        checked(library.BCryptImportKeyPair(algorithm, None, "RSAPUBLICBLOB", ctypes.byref(key), key_buffer, len(blob), 0), "import")
        if not key.value:
            raise NativeSignatureError("import", 0xC0000008)
        digest_buffer = ctypes.create_string_buffer(hashlib.sha256(raw).digest())
        signature_buffer = ctypes.create_string_buffer(signature)
        padding = Padding("SHA256")
        checked(library.BCryptVerifySignature(key, ctypes.byref(padding), digest_buffer, 32, signature_buffer, len(signature), 2), "verify")
    finally:
        if key.value:
            library.BCryptDestroyKey(key)
        if algorithm.value:
            library.BCryptCloseAlgorithmProvider(algorithm, 0)


class FileLock:
    def __init__(self, path):
        self.path, self.file = Path(path), None

    def acquire(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.file = self.path.open("a+b")
        if self.file.tell() == 0:
            self.file.write(b"0"); self.file.flush()
        self.file.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            self.file.close(); self.file = None
            return False

    def release(self):
        if self.file is None:
            return
        try:
            self.file.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_UN)
        finally:
            self.file.close(); self.file = None


def strict_json(data):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise UpdateError("The release metadata contains duplicate keys.")
            result[key] = value
        return result
    try:
        return json.loads(data, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(UpdateError("Invalid number in release metadata.")))
    except (UnicodeError, ValueError, TypeError) as error:
        raise UpdateError("The release metadata is invalid.") from error


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False), encoding="utf-8")
        for attempt in range(20):
            try:
                os.replace(temporary, path); return
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(.03)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path):
    try:
        return strict_json(Path(path).read_bytes())
    except (OSError, ValueError):
        return None


def digest(path):
    hasher = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(128 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def version(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,5})(?:\.(?:0|[1-9][0-9]{0,5})){2,3}", value):
        raise UpdateError("The release version is invalid.")
    return tuple(int(part) for part in value.split(".")) + (0,) * (4 - len(value.split(".")))


def current_version(app_root=APP_ROOT):
    manifest = read_json(Path(app_root) / "extension/manifest.json") or {}
    value = manifest.get("version", "0.0.0")
    version(value)
    return value


def update_root(cache, app_root=APP_ROOT):
    identity = hashlib.sha256(str(Path(app_root).resolve()).casefold().encode("utf-8")).hexdigest()[:20]
    return Path(cache).resolve() / "updates" / identity


def state_path(cache, app_root=APP_ROOT):
    return update_root(cache, app_root) / "state.json"


def pid_alive(pid):
    if not isinstance(pid, int) or pid < 1:
        return False
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x00100000, False, pid)
        if not handle:
            return False
        try:
            return kernel.WaitForSingleObject(handle, 0) == 0x102
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0); return True
    except OSError:
        return False


def save_state(cache, state, app_root=APP_ROOT):
    value = dict(state)
    value.setdefault("currentVersion", current_version(app_root))
    value["updatedAt"] = time.time()
    atomic_json(state_path(cache, app_root), value)
    return value


def status(cache, app_root=APP_ROOT):
    state = read_json(state_path(cache, app_root)) or {}
    if state.get("status") in ACTIVE:
        if not any(pid_alive(state.get(key)) for key in ("ownerPid", "runnerPid")):
            state = recover_interrupted(cache, app_root, state)
    installed = current_version(app_root)
    if not state:
        state = {"status": "current", "currentVersion": installed, "latestVersion": installed, "message": "Check for updates when you are ready."}
    return {key: item for key, item in {**state, "currentVersion": installed}.items()
            if key not in {"ownerPid", "runnerPid", "operation", "stageDirectory", "appRoot", "manifest", "signature"}}


def installing(cache, app_root=APP_ROOT):
    # Normal word clicks need one small state read, not a signature check,
    # version lookup or network request. Recovery is relevant only mid-update.
    state = read_json(state_path(cache, app_root)) or {}
    if state.get("status") not in ACTIVE:
        return False
    if any(pid_alive(state.get(key)) for key in ("ownerPid", "runnerPid")):
        return True
    return status(cache, app_root).get("status") in ACTIVE


def config(app_root=APP_ROOT):
    value = read_json(Path(app_root) / "helper/update-config.json")
    if not isinstance(value, dict) or value.get("enabled") is not True:
        raise UpdateError("Updates are not connected to a published release channel yet.")
    if value.get("schema") != 1 or value.get("channel") != "stable":
        raise UpdateError("The update channel configuration is invalid.")
    if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?", str(value.get("owner", ""))):
        raise UpdateError("The update publisher is invalid.")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", str(value.get("repository", ""))):
        raise UpdateError("The update repository is invalid.")
    key = value.get("publicKeyXml")
    if not isinstance(key, str) or not 100 < len(key) < 8192 or not key.startswith("<RSAKeyValue>"):
        raise UpdateError("The publisher signing key is unavailable.")
    # An accidental private signing key must never be distributed in a config.
    if any("<" + part + ">" in key for part in ("D", "P", "Q", "DP", "DQ", "InverseQ")):
        raise UpdateError("The publisher key must contain public fields only.")
    return value


def safe_url(url, settings, api=False, *, latest_metadata=False):
    parts = urllib.parse.urlsplit(str(url))
    if parts.scheme != "https" or parts.username or parts.password or parts.port not in (None, 443) or parts.fragment:
        raise UpdateError("The release download address is invalid.")
    prefix = "/repos/" + settings["owner"] + "/" + settings["repository"] + "/releases/"
    if latest_metadata:
        valid = not api and parts.hostname == "github.com" and (not parts.query or re.fullmatch(r"ikr_check=(?:0|[1-9][0-9]{0,11})", parts.query)) and parts.path == (
            "/" + settings["owner"] + "/" + settings["repository"] + "/releases/latest/download/update-manifest.json")
    elif api:
        valid = parts.hostname == "api.github.com" and parts.path.startswith(prefix)
    else:
        prefix = "/" + settings["owner"] + "/" + settings["repository"] + "/releases/download/"
        valid = parts.hostname == "github.com" and parts.path.startswith(prefix)
    if not valid or ".." in urllib.parse.unquote(parts.path).split("/"):
        raise UpdateError("The update does not belong to the configured publisher.")
    return str(url)


class ReleaseRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        target = urllib.parse.urlsplit(newurl)
        if (target.scheme != "https" or target.username or target.password or target.port not in (None, 443)
                or target.hostname not in {"github.com", "api.github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com", "github-releases.githubusercontent.com"}):
            raise UpdateError("GitHub returned an unexpected download redirect.")
        return super().redirect_request(request, fp, code, message, headers, newurl)


def download(url, limit, target=None, progress=None):
    headers = {"User-Agent": "iKnow-Reading-Helper-Updater/1", "Accept": "application/vnd.github+json" if "api.github.com" in url else "application/octet-stream"}
    if urllib.parse.urlsplit(url).path.endswith("/update-manifest.json"):
        # Latest release discovery must revalidate the moving GitHub redirect;
        # immutable signatures and archives retain their ordinary cache policy.
        headers.update({"Cache-Control": "no-cache, max-age=0", "Pragma": "no-cache"})
    request = urllib.request.Request(url, headers=headers)
    opener = urllib.request.build_opener(ReleaseRedirect())
    started = time.monotonic()
    payload = bytearray() if target is None else None
    stream = None
    total = 0
    try:
        with opener.open(request, timeout=20) as response:
            declared = response.headers.get("Content-Length")
            if declared and (not declared.isdigit() or int(declared) > limit):
                raise UpdateError("The release download is larger than expected.")
            if target is not None:
                stream = Path(target).open("xb")
            while True:
                if time.monotonic() - started > 240:
                    raise UpdateError("The release download timed out. Please try again.")
                block = response.read(128 * 1024)
                if not block:
                    break
                total += len(block)
                if total > limit:
                    raise UpdateError("The release download exceeded its size limit.")
                if stream:
                    stream.write(block)
                else:
                    payload.extend(block)
                if progress:
                    progress(total)
            if declared and total != int(declared):
                raise UpdateError("The release download was interrupted.")
        return bytes(payload) if payload is not None else total
    except (urllib.error.URLError, OSError) as error:
        raise UpdateError("The update could not be downloaded. Check your connection and try again.") from error
    finally:
        if stream:
            stream.close()


def verify_signature(raw, encoded_signature, public_key, *, timeout=25):
    if os.name != "nt":
        raise UpdateError("Signed updates currently require Windows.")
    try:
        signature = base64.b64decode(encoded_signature.strip(), validate=True)
    except (ValueError, TypeError) as error:
        raise UpdateError("The release signature is invalid.") from error
    if not 256 <= len(signature) <= 512:
        raise UpdateError("The release signature is invalid.")
    evidence = {"provider": "windows-bcrypt", "trustedKeySha256": hashlib.sha256(public_key.encode("utf-8")).hexdigest(),
                "metadataSha256": hashlib.sha256(raw).hexdigest(), "signatureSha256": hashlib.sha256(signature).hexdigest()}
    try:
        _bcrypt_verify(public_key, raw, signature)
    except NativeSignatureError as error:
        evidence.update(step=error.stage, ntstatus=error.ntstatus)
        if error.stage == "verify" and error.ntstatus == 0xC000A000:
            raise SignatureVerificationError("The release signature does not match the trusted publisher.", "signature_mismatch", evidence) from error
        raise SignatureVerificationError("Windows could not complete the publisher signature check. Export Diagnostics for the Windows status.", "signature_runtime_error", evidence) from error
    except OSError as error:
        evidence["step"] = "library"
        if type(getattr(error, "winerror", None)) is int:
            evidence["winerror"] = error.winerror
        raise SignatureVerificationError("Windows cryptographic verification is unavailable. Export Diagnostics for details.", "signature_verifier_unavailable", evidence) from error
    except (ValueError, TypeError, AttributeError, ET.ParseError) as error:
        evidence["step"] = "key"
        raise SignatureVerificationError("The installed publisher public key could not be read. Export Diagnostics for details.", "signature_runtime_error", evidence) from error


def diagnostic_snapshot(cache, app_root=APP_ROOT):
    """Read existing update support fields without checking or installing updates."""
    result = {}
    try:
        settings = config(app_root)
        result["trustedKeySha256"] = hashlib.sha256(settings["publicKeyXml"].encode("utf-8")).hexdigest()
    except UpdateError:
        result["configuration"] = "unavailable"
    state = read_json(state_path(cache, app_root)) or {}
    if state.get("status") in {"available", "current", "error", "unconfigured", "complete", "downloading", "installing"}:
        result["status"] = state["status"]
    evidence = state.get("verification")
    if isinstance(evidence, dict):
        safe = {}
        for key in ("trustedKeySha256", "metadataSha256", "signatureSha256"):
            if isinstance(evidence.get(key), str) and HASH.fullmatch(evidence[key]):
                safe[key] = evidence[key]
        for key, pattern in (("code", r"signature_[a-z_]{1,60}"), ("provider", r"windows-(?:cng|bcrypt)"), ("step", r"(?:input|key|library|provider|import|verify)"),
                             ("exceptionType", r"[A-Za-z][A-Za-z0-9_.+]{0,159}"), ("powershellVersion", r"[0-9.]{1,32}"),
                             ("languageMode", r"(?:FullLanguage|ConstrainedLanguage|RestrictedLanguage|NoLanguage)")):
            if isinstance(evidence.get(key), str) and re.fullmatch(pattern, evidence[key]):
                safe[key] = evidence[key]
        for key in ("exitCode", "hresult", "ntstatus", "winerror"):
            if type(evidence.get(key)) is int and -(2**31) <= evidence[key] < 2**32:
                safe[key] = evidence[key]
        if safe:
            result["verification"] = safe
    return result


def managed_path(value):
    if not isinstance(value, str) or not value or len(value) > 220 or re.search(r'[\\:<>"|?*\x00-\x1f]', value):
        raise UpdateError("The update contains an unsafe file path.")
    path = PurePosixPath(value)
    if path.is_absolute() or path.as_posix() != value or any(part in {"", ".", ".."} for part in path.parts):
        raise UpdateError("The update contains an unsafe file path.")
    for part in path.parts:
        if part.endswith((".", " ")) or re.fullmatch(r"(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?", part, re.I):
            raise UpdateError("The update contains an unsupported Windows file name.")
    if len(path.parts) > 1:
        if path.parts[0] not in {"extension", "helper"} or any(part.startswith(".") for part in path.parts[1:]):
            raise UpdateError("The update contains a file outside the application.")
    elif value != ".gitignore" and path.suffix.lower() not in {".md", ".txt", ".json", ".cmd"}:
        raise UpdateError("The update contains an unexpected application file.")
    return path


def checked_target(app_root, relative):
    relative = managed_path(relative)
    root = Path(app_root).resolve()
    target = root.joinpath(*relative.parts)
    current = root
    for part in relative.parts:
        current = current / part
        if current.exists() or current.is_symlink():
            attributes = getattr(current.lstat(), "st_file_attributes", 0)
            if current.is_symlink() or attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400):
                raise UpdateError("The application contains a linked path. Update it manually.")
    if not target.resolve().is_relative_to(root):
        raise UpdateError("The update path is outside the application folder.")
    return target


def validate_manifest(raw, settings, installed, helper_version):
    value = strict_json(raw)
    if not isinstance(value, dict) or value.get("schema") != 1:
        raise UpdateError("The release manifest format is unsupported.")
    if version(value.get("version")) < version(installed):
        raise UpdateError("An older release cannot replace this installation.")
    version(value.get("helperVersion"))
    if version(value.get("minimumHelperVersion", "0.0.0")) > version(helper_version):
        raise UpdateError("This release needs a newer installer. Download its setup package manually.")
    asset = value.get("asset")
    if not isinstance(asset, dict) or not HASH.fullmatch(str(asset.get("sha256", ""))):
        raise UpdateError("The archive digest is missing.")
    if type(asset.get("size")) is not int or not 0 < asset["size"] <= MAX_ARCHIVE:
        raise UpdateError("The archive size is invalid.")
    if not isinstance(asset.get("name"), str) or "/" in asset["name"] or "\\" in asset["name"] or not asset["name"].endswith(".zip"):
        raise UpdateError("The archive name is invalid.")
    safe_url(asset.get("url"), settings)
    files = value.get("files")
    if not isinstance(files, dict) or not 3 <= len(files) <= MAX_FILES:
        raise UpdateError("The release file list is invalid.")
    normalized = set()
    for name, expected in files.items():
        managed_path(name)
        if not HASH.fullmatch(str(expected)) or name.casefold() in normalized:
            raise UpdateError("The release file list is invalid.")
        normalized.add(name.casefold())
    if not {"extension/manifest.json", "helper/native_host.py", "RELEASE-FILES.json"}.issubset(files):
        raise UpdateError("The release is missing required application files.")
    deleted = value.get("deleteFiles", [])
    if not isinstance(deleted, list) or len(deleted) > MAX_FILES:
        raise UpdateError("The release removal list is invalid.")
    for name in deleted:
        managed_path(name)
        if name.casefold() in normalized:
            raise UpdateError("A release file is also marked for removal.")
        normalized.add(name.casefold())
    return value


def remember_diagnostic_metadata(cache, app_root, settings, raw, signature):
    """Retain only the last small public metadata pair during a normal check.

    The pair is deliberately labelled unverified: diagnostics always checks
    it again with the current pinned key before drawing a trust conclusion.
    Failure to write support evidence must not prevent an ordinary update.
    """
    if len(raw) > 512 * 1024 or len(signature) > 4096:
        return
    try:
        value = {"schema": 1, "owner": settings["owner"], "repository": settings["repository"],
                 "capturedAt": time.time(), "trustedKeySha256": hashlib.sha256(settings["publicKeyXml"].encode("utf-8")).hexdigest(),
                 "rawBase64": base64.b64encode(raw).decode("ascii"), "signatureBase64": base64.b64encode(signature).decode("ascii")}
        atomic_json(update_root(cache, app_root) / "diagnostic-metadata.json", value)
    except (OSError, ValueError, KeyError):
        pass


def _cached_signature(cache, app_root, settings, raw):
    """Reuse only public signature bytes, never a previous trust decision."""
    if cache is None:
        return None
    try:
        with (update_root(cache, app_root) / "diagnostic-metadata.json").open("rb") as stream:
            saved = stream.read(768 * 1024 + 1)
        if len(saved) > 768 * 1024:
            return None
        value = strict_json(saved)
        if (not isinstance(value, dict) or value.get("schema") != 1 or value.get("owner") != settings["owner"]
                or value.get("repository") != settings["repository"]
                or value.get("trustedKeySha256") != hashlib.sha256(settings["publicKeyXml"].encode("utf-8")).hexdigest()):
            return None
        previous = base64.b64decode(value.get("rawBase64", ""), validate=True)
        signature = base64.b64decode(value.get("signatureBase64", ""), validate=True)
        return signature if previous == raw and 0 < len(signature) <= 4096 else None
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        return None


def get_latest_release(settings, installed, helper_version, *, cache=None, app_root=APP_ROOT, on_metadata=None):
    """Discover signed public metadata without consuming GitHub REST quota.

    The moving latest URL supplies candidate data only. Even unchanged cached
    signature bytes are verified again against the current pinned publisher
    key. Installation separately rechecks release membership with get_release.
    """
    prefix = "https://github.com/" + settings["owner"] + "/" + settings["repository"]
    # A public time bucket prevents an intermediary from reusing the moving
    # latest redirect for many checks. It contains no user/install identifier.
    bucket = max(0, int(time.time()) // 45)
    metadata = download(safe_url(prefix + "/releases/latest/download/update-manifest.json?ikr_check=" + str(bucket), settings,
                                 latest_metadata=True), min(MAX_METADATA, 512 * 1024))
    candidate = strict_json(metadata)
    if not isinstance(candidate, dict):
        raise UpdateError("The release manifest format is unsupported.")
    declared = candidate.get("version")
    version(declared)
    version_prefix = prefix + "/releases/download/v" + declared + "/"
    signature = _cached_signature(cache, app_root, settings, metadata)
    verified = False
    if signature is not None:
        try:
            verify_signature(metadata, signature, settings["publicKeyXml"])
            verified = True
        except UpdateError:
            # A stale/tampered support cache cannot suppress a fresh signature
            # lookup or become an authority for a later trust decision.
            pass
    if not verified:
        signature = download(safe_url(version_prefix + "update-manifest.sig", settings), 4096)
    if on_metadata is not None:
        on_metadata(metadata, signature)
    if not verified:
        verify_signature(metadata, signature, settings["publicKeyXml"])
    # Discovery can briefly receive the previous signed release from a CDN just
    # after installation. It is candidate metadata, never an install request:
    # validate every signed field without treating this observation as a
    # downgrade. The explicit installer still uses the actual installed floor.
    manifest = validate_manifest(metadata, settings, declared if version(declared) < version(installed) else installed, helper_version)
    expected_archive = version_prefix + urllib.parse.quote(manifest["asset"]["name"], safe="")
    if manifest["asset"]["url"] != expected_archive:
        raise UpdateError("The signed archive does not belong to this release version.")
    return manifest, metadata, signature


def get_release(settings, installed, helper_version, *, on_metadata=None):
    endpoint = "https://api.github.com/repos/" + settings["owner"] + "/" + settings["repository"] + "/releases/latest"
    raw = download(safe_url(endpoint, settings, api=True), MAX_METADATA)
    release = strict_json(raw)
    if not isinstance(release, dict) or release.get("draft") is not False or release.get("prerelease") is not False:
        raise UpdateError("No stable update is published yet.")
    assets = release.get("assets")
    if not isinstance(assets, list) or len(assets) > 1000:
        raise UpdateError("The release asset list is invalid.")
    required = {}
    for asset in assets:
        if isinstance(asset, dict) and asset.get("name") in {"update-manifest.json", "update-manifest.sig"}:
            if asset["name"] in required:
                raise UpdateError("The release contains duplicate update manifests.")
            required[asset["name"]] = safe_url(asset.get("browser_download_url"), settings)
    if set(required) != {"update-manifest.json", "update-manifest.sig"}:
        raise UpdateError("The published version has no signed update package yet.")
    metadata = download(required["update-manifest.json"], MAX_METADATA)
    signature = download(required["update-manifest.sig"], 4096)
    if on_metadata is not None:
        on_metadata(metadata, signature)
    verify_signature(metadata, signature, settings["publicKeyXml"])
    manifest = validate_manifest(metadata, settings, installed, helper_version)
    matching = [asset for asset in assets if isinstance(asset, dict) and asset.get("name") == manifest["asset"]["name"]
                and asset.get("browser_download_url") == manifest["asset"]["url"]]
    if len(matching) != 1 or matching[0].get("size") != manifest["asset"]["size"]:
        raise UpdateError("The signed package is not present in this release.")
    return manifest, metadata, signature


def extract_archive(archive, destination, manifest):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    files, seen, expanded = manifest["files"], set(), 0
    try:
        with zipfile.ZipFile(archive) as bundle:
            if len(bundle.infolist()) > MAX_FILES + 100:
                raise UpdateError("The archive contains too many entries.")
            for entry in bundle.infolist():
                if entry.is_dir():
                    # Directories need no extraction. Still reject traversal.
                    managed_path(entry.filename.rstrip("/") + "/directory-entry.txt"); continue
                name = entry.filename
                relative = managed_path(name)
                mode = entry.external_attr >> 16
                if stat.S_ISLNK(mode) or (mode and stat.S_IFMT(mode) not in {0, stat.S_IFREG}):
                    raise UpdateError("The release contains a linked or special file.")
                if name not in files or name.casefold() in seen or entry.flag_bits & 1:
                    raise UpdateError("The archive does not match its signed file list.")
                if entry.file_size > MAX_FILE or entry.file_size < 0:
                    raise UpdateError("A release file is too large.")
                expanded += entry.file_size
                if expanded > MAX_EXPANDED:
                    raise UpdateError("The expanded archive exceeds the update size limit.")
                target = destination.joinpath(*relative.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                hasher, count = hashlib.sha256(), 0
                with bundle.open(entry) as source, target.open("xb") as output:
                    while True:
                        block = source.read(128 * 1024)
                        if not block:
                            break
                        count += len(block)
                        if count > entry.file_size or count > MAX_FILE:
                            raise UpdateError("A release file exceeded its declared size.")
                        hasher.update(block); output.write(block)
                if count != entry.file_size or hasher.hexdigest() != files[name]:
                    raise UpdateError("A release file failed its integrity check.")
                seen.add(name.casefold())
    except (OSError, zipfile.BadZipFile, RuntimeError) as error:
        raise UpdateError("The release archive is incomplete or invalid.") from error
    if seen != {name.casefold() for name in files}:
        raise UpdateError("The release archive is missing signed files.")
    extension = read_json(destination / "extension/manifest.json") or {}
    if extension.get("version") != manifest["version"] or extension.get("manifest_version") != 3:
        raise UpdateError("The extension version does not match the signed release.")
    host_text = (destination / "helper/native_host.py").read_text(encoding="utf-8")
    if not re.search(r'^HOST_VERSION\s*=\s*[\'"]' + re.escape(manifest["helperVersion"]) + r'[\'"]\s*$', host_text, re.M):
        raise UpdateError("The helper version does not match the signed release.")
    baseline = read_json(destination / "RELEASE-FILES.json") or {}
    expected = {name: expected for name, expected in files.items() if name != "RELEASE-FILES.json"}
    if baseline.get("version") != manifest["version"] or baseline.get("sha256") != expected:
        raise UpdateError("The managed-file baseline does not match the release.")


def validate_baseline(app_root, manifest):
    baseline = read_json(Path(app_root) / "RELEASE-FILES.json")
    if not isinstance(baseline, dict) or not isinstance(baseline.get("sha256"), dict):
        raise UpdateError("This folder has no managed update baseline. Install the complete update-ready package once.")
    tracked = baseline["sha256"]
    for name, expected in tracked.items():
        managed_path(name)
        if not HASH.fullmatch(str(expected)):
            raise UpdateError("The installed file baseline is invalid.")
    for name in set(manifest["files"]) | set(manifest.get("deleteFiles", [])):
        target = checked_target(app_root, name)
        if target.exists():
            if not target.is_file():
                raise UpdateError("An update target is not a regular file.")
            if name == "RELEASE-FILES.json":
                continue
            if name not in tracked or digest(target) != tracked[name]:
                raise UpdateError("A managed application file was changed locally: " + name + ". Keep a copy and restore the release file before updating.")
        elif name in manifest.get("deleteFiles", []):
            continue
        elif name in tracked:
            raise UpdateError("A managed application file is missing: " + name + ". Restore the release file before updating.")
    # The publisher may remove only files that the previous release owns.
    if any(name not in tracked for name in manifest.get("deleteFiles", [])):
        raise UpdateError("The release attempts to remove an unmanaged file.")
    return baseline


def validate_permissions(app_root, extracted):
    """Require manual adoption when a release expands browser access."""
    before = read_json(Path(app_root) / "extension/manifest.json") or {}
    after = read_json(Path(extracted) / "extension/manifest.json") or {}
    for field in ("permissions", "host_permissions", "optional_permissions", "optional_host_permissions"):
        previous, upcoming = before.get(field, []), after.get(field, [])
        if not isinstance(previous, list) or not isinstance(upcoming, list):
            raise UpdateError("The extension permissions are invalid.")
        if any(not isinstance(value, str) for value in previous + upcoming) or not set(upcoming).issubset(previous):
            raise UpdateError("This release adds browser permissions. Download and install its complete package manually.")
    old_matches = {value for script in before.get("content_scripts", []) for value in script.get("matches", [])}
    new_matches = {value for script in after.get("content_scripts", []) for value in script.get("matches", [])}
    if not new_matches.issubset(old_matches):
        raise UpdateError("This release adds website access. Download and install its complete package manually.")
    if after.get("externally_connectable") != before.get("externally_connectable"):
        raise UpdateError("This release changes external connections. Install its complete package manually.")


def activity_locks(cache):
    root = Path(cache)
    paths = [root / "model.lock", root / "neural/synthesis.lock", root / "neural/engine-start.lock",
             root / "neural/course-jobs/worker.lock", root / "neural/course-jobs/launch.lock"]
    paths += list((root / "jobs").glob("*.lock")) if (root / "jobs").exists() else []
    paths += list((root / "neural/course-jobs").glob("*.lock")) if (root / "neural/course-jobs").exists() else []
    acquired = []
    try:
        for path in dict.fromkeys(paths):
            lock = FileLock(path)
            if not lock.acquire():
                raise UpdateBusy("Pause course and word-audio preparation, wait for playback to finish, then install the update.")
            acquired.append(lock)
        return acquired
    except Exception:
        for lock in reversed(acquired):
            lock.release()
        raise


def _check(cache, helper_version, app_root=APP_ROOT):
    installed = current_version(app_root)
    try:
        settings = config(app_root)
    except UpdateError as error:
        return save_state(cache, {"status": "unconfigured", "currentVersion": installed, "latestVersion": installed, "message": str(error)}, app_root)
    manifest, raw, signature = get_latest_release(settings, installed, helper_version, cache=cache, app_root=app_root,
        on_metadata=lambda raw, sig: remember_diagnostic_metadata(cache, app_root, settings, raw, sig))
    observed = manifest["version"]
    previous = read_json(state_path(cache, app_root)) or {}
    try:
        keep_notice = previous.get("status") == "available" and version(previous.get("latestVersion")) > max(version(installed), version(observed))
    except UpdateError:
        keep_notice = False
    if keep_notice:
        return save_state(cache, {"status": "available", "currentVersion": installed, "latestVersion": previous["latestVersion"],
            "metadataVersion": observed, "metadataStale": True, "message": "A new version is ready to install."}, app_root)
    available = version(observed) > version(installed)
    return save_state(cache, {"status": "available" if available else "current", "currentVersion": installed,
                             "latestVersion": observed if available else installed, "metadataVersion": observed,
                             "metadataStale": version(observed) < version(installed),
                             "message": "A new version is ready to install." if available else "You are up to date."}, app_root)


def _stage_is_safe(stage, expected_root):
    """Check exact ownership boundaries before any recursive stage removal."""
    stage, expected_root = Path(stage).absolute(), Path(expected_root).absolute()
    if stage.parent != expected_root or not re.fullmatch(r"stage-[a-f0-9]{32}", stage.name):
        return False
    try:
        # A junction at updates/, the per-install root or any descendant must
        # never turn cleanup into deletion elsewhere in the user's filesystem.
        for path in (expected_root.parent, expected_root, stage):
            if path.is_symlink() or getattr(path.lstat(), "st_file_attributes", 0) & 0x400:
                return False
        if stage.resolve().parent != expected_root.resolve():
            return False
        pending = [stage]
        while pending:
            current = pending.pop()
            with os.scandir(current) as entries:
                for entry in entries:
                    attributes = getattr(entry.stat(follow_symlinks=False), "st_file_attributes", 0)
                    if entry.is_symlink() or attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400):
                        return False
                    if entry.is_dir(follow_symlinks=False):
                        pending.append(Path(entry.path))
        return True
    except OSError:
        return False


def prune_stages(cache, app_root=APP_ROOT, keep=3):
    """Retain recent verified backups; never prune active or uncertain stages."""
    app_root, cache_root = Path(app_root).resolve(), Path(cache).resolve()
    expected = update_root(cache_root, app_root)
    if not expected.is_dir():
        return []
    state = read_json(state_path(cache_root, app_root)) or {}
    current_operation = state.get("operation") if state.get("status") in ACTIVE else None
    eligible = []
    for stage in expected.iterdir():
        if not _stage_is_safe(stage, expected):
            continue
        operation = stage.name[len("stage-"):]
        if operation == current_operation:
            continue
        transaction = read_json(stage / "transaction.json")
        owner = transaction or read_json(stage / "stage-owner.json")
        if (not isinstance(owner, dict) or owner.get("schema") != 1 or owner.get("operation") != operation
                or not isinstance(owner.get("appRoot"), str) or not isinstance(owner.get("cacheRoot"), str)):
            continue
        try:
            if Path(owner["appRoot"]).resolve() != app_root or Path(owner["cacheRoot"]).resolve() != cache_root:
                continue
        except (OSError, ValueError):
            continue
        journal = read_json(stage / "journal.json")
        if (stage / "journal.json").exists() and not isinstance(journal, dict):
            continue
        if journal is not None and journal.get("state") not in {"complete", "rolled_back"}:
            continue
        # A transaction without a terminal journal may still be awaiting its
        # runner. Only abandoned downloads without a transaction can be pruned.
        if transaction is not None and journal is None:
            continue
        if any(pid_alive(owner.get(key)) for key in ("parentPid", "ownerPid", "runnerPid")):
            continue
        try:
            eligible.append((stage.stat().st_mtime_ns, stage))
        except OSError:
            continue
    removed = []
    for _, stage in sorted(eligible, reverse=True)[max(0, int(keep)):]:
        # Recheck the absolute boundary and the tree immediately before rmtree.
        if not _stage_is_safe(stage, expected):
            continue
        try:
            shutil.rmtree(stage)
            removed.append(stage.name)
        except OSError:
            # Antivirus/locked backup files may delay housekeeping. An update
            # should not fail because an old, otherwise safe backup is retained.
            pass
    return removed


def install(cache, helper_version, app_root=APP_ROOT, busy=None):
    app_root = Path(app_root).resolve()
    settings = config(app_root)
    installed = current_version(app_root)
    if busy and busy():
        raise UpdateBusy("Pause preparation and wait for playback to finish before updating.")
    locks = activity_locks(cache)
    try:
        prune_stages(cache, app_root)
        operation = uuid.uuid4().hex
        base = {"status": "downloading", "currentVersion": installed, "latestVersion": installed,
                "ownerPid": os.getpid(), "operation": operation, "message": "Checking the signed release …", "progress": 0}
        save_state(cache, base, app_root)
        manifest, raw, signature = get_release(settings, installed, helper_version,
                                             on_metadata=lambda raw, sig: remember_diagnostic_metadata(cache, app_root, settings, raw, sig))
        if version(manifest["version"]) <= version(installed):
            return save_state(cache, {**base, "status": "current", "latestVersion": installed, "message": "You are up to date."}, app_root)
        base.update(latestVersion=manifest["version"], message="Downloading the update …")
        save_state(cache, base, app_root)
        stage = update_root(cache, app_root) / ("stage-" + operation)
        stage.mkdir(parents=True, exist_ok=False)
        atomic_json(stage / "stage-owner.json", {"schema": 1, "appRoot": str(app_root), "cacheRoot": str(Path(cache).resolve()),
                                               "operation": operation, "ownerPid": os.getpid()})
        archive = stage / "application.zip"
        last = [0.0]
        def progress(count):
            now = time.monotonic()
            if now - last[0] >= .5:
                save_state(cache, {**base, "progress": min(.95, count / manifest["asset"]["size"] * .9)}, app_root)
                last[0] = now
        download(manifest["asset"]["url"], manifest["asset"]["size"], archive, progress)
        if archive.stat().st_size != manifest["asset"]["size"] or digest(archive) != manifest["asset"]["sha256"]:
            raise UpdateError("The update archive failed its integrity check.")
        extract_archive(archive, stage / "files", manifest)
        validate_baseline(app_root, manifest)
        validate_permissions(app_root, stage / "files")
        (stage / "update-manifest.json").write_bytes(raw)
        (stage / "update-manifest.sig").write_bytes(signature)
        shutil.copy2(Path(__file__), stage / "updater.py")
        shutil.copy2(Path(__file__).with_name("update_runner.py"), stage / "update_runner.py")
        atomic_json(stage / "transaction.json", {"schema": 1, "appRoot": str(app_root), "cacheRoot": str(Path(cache).resolve()),
                                                  "operation": operation, "parentPid": os.getpid(), "helperVersion": helper_version,
                                                  "publicKeyXml": settings["publicKeyXml"], "owner": settings["owner"], "repository": settings["repository"]})
        flags = (subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS) if os.name == "nt" else 0
        runner = subprocess.Popen([sys.executable, "-u", str(stage / "update_runner.py"), str(stage)],
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  close_fds=True, creationflags=flags)
        final = save_state(cache, {**base, "status": "installing", "runnerPid": runner.pid,
                                  "stageDirectory": str(stage), "message": "Installing the update …", "progress": .96}, app_root)
        # The copied runner waits for this complete state and then for this host
        # to exit. The browser closes its installation port after our response.
        (stage / "ready").touch()
        return final
    finally:
        for lock in reversed(locks):
            lock.release()


def handle(message, cache, send, helper_version, busy=None):
    kind = message.get("type")
    request_id = message.get("requestId")
    def reply(state, ok=True):
        public = {key: item for key, item in state.items()
                  if key not in {"ownerPid", "runnerPid", "operation", "stageDirectory", "appRoot", "manifest", "signature"}}
        try:
            send({"type": "update:result", "requestId": request_id, "ok": ok, "state": public})
        except (OSError, InterruptedError):
            pass
    if kind == "update:status":
        reply(status(cache)); return
    if kind not in {"update:check", "update:install"}:
        raise UpdateError("Unknown update request.")
    def run():
        guard = FileLock(update_root(cache) / "operation.lock")
        try:
            # Recover a dead previous runner before taking the same lock that
            # recovery itself needs. Live updates remain protected by the lock
            # and the second state read below.
            status(cache)
            if not guard.acquire():
                existing = status(cache)
                reply(existing if existing.get("status") in ACTIVE else {**existing, "status": "busy", "message": "Another update check is in progress."}, False)
                return
            existing = status(cache)
            if existing.get("status") in ACTIVE:
                reply(existing, False); return
            if kind == "update:install":
                state = install(cache, helper_version, busy=busy)
            else:
                state = _check(cache, helper_version)
            reply(state)
        except UpdateBusy as error:
            reply({**status(cache), "status": "busy", "message": str(error)}, False)
        except Exception as error:
            text = str(error) if isinstance(error, UpdateError) else "The update could not be completed. Check Diagnostics or try again."
            state = {**status(cache), "status": "error", "message": text}
            if isinstance(error, SignatureVerificationError):
                state["verification"] = error.verification
                state["code"] = error.code
            else:
                state.pop("verification", None)
                state.pop("code", None)
            state = save_state(cache, state)
            reply(state, False)
        finally:
            guard.release()
            with _thread_lock:
                _threads.discard(threading.current_thread())
    thread = threading.Thread(target=run, name="application-update", daemon=False)
    with _thread_lock:
        _threads.add(thread)
    thread.start()


def transaction_apply(stage, fail_after=None):
    """Apply a verified transaction with a durable rollback journal.

    fail_after is used only by isolated regression tests; it is never sourced
    from a browser or release manifest.
    """
    stage = Path(stage).resolve()
    transaction = read_json(stage / "transaction.json") or {}
    app_root, cache = Path(transaction["appRoot"]).resolve(), Path(transaction["cacheRoot"]).resolve()
    if not stage.is_relative_to(update_root(cache, app_root)) or not stage.name.startswith("stage-"):
        raise UpdateError("The staged update is outside its transaction directory.")
    settings = {"owner": transaction["owner"], "repository": transaction["repository"], "publicKeyXml": transaction["publicKeyXml"]}
    raw, signature = (stage / "update-manifest.json").read_bytes(), (stage / "update-manifest.sig").read_bytes()
    # Re-read the installed pinned key, never accept only a staged substitute.
    trusted = config(app_root)
    if any(trusted.get(key) != settings[key] for key in settings):
        raise UpdateError("The update publisher changed after staging.")
    verify_signature(raw, signature, trusted["publicKeyXml"])
    manifest = validate_manifest(raw, trusted, current_version(app_root), transaction["helperVersion"])
    validate_baseline(app_root, manifest)
    validate_permissions(app_root, stage / "files")
    for name, expected in manifest["files"].items():
        file = checked_target(stage / "files", name)
        if not file.is_file() or digest(file) != expected:
            raise UpdateError("The staged release changed after verification.")
    backups, journal = stage / "backup", stage / "journal.json"
    backups.mkdir(exist_ok=True)
    changed = []
    names = sorted((set(manifest["files"]) | set(manifest.get("deleteFiles", []))) - {"RELEASE-FILES.json"}) + ["RELEASE-FILES.json"]
    try:
        for name in names:
            target = checked_target(app_root, name)
            exists = target.exists()
            saved = backups.joinpath(*PurePosixPath(name).parts)
            if exists:
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, saved)
            changed.append({"name": name, "existed": exists})
            atomic_json(journal, {"state": "applying", "files": changed})
            if name in manifest["files"]:
                source = stage / "files" / name
                target.parent.mkdir(parents=True, exist_ok=True)
                temporary = target.with_name(target.name + ".update-" + transaction["operation"])
                try:
                    shutil.copy2(source, temporary)
                    os.replace(temporary, target)
                finally:
                    temporary.unlink(missing_ok=True)
            else:
                target.unlink(missing_ok=True)
            if fail_after is not None and len(changed) == fail_after:
                raise OSError("Injected transaction failure")
        atomic_json(journal, {"state": "complete", "files": changed})
        return manifest
    except Exception:
        rollback(stage, app_root)
        raise


def rollback(stage, app_root):
    stage = Path(stage)
    journal = read_json(stage / "journal.json") or {}
    failures = []
    for entry in reversed(journal.get("files", [])):
        try:
            target = checked_target(app_root, entry["name"])
            if entry["existed"]:
                source = stage / "backup" / entry["name"]
                temporary = target.with_name(target.name + ".restore-" + uuid.uuid4().hex)
                shutil.copy2(source, temporary)
                os.replace(temporary, target)
            else:
                target.unlink(missing_ok=True)
        except OSError:
            failures.append(entry["name"])
    atomic_json(stage / "journal.json", {**journal, "state": "rollback_failed" if failures else "rolled_back", "restoreFailures": failures})
    if failures:
        raise UpdateError("Some files could not be restored. Keep this update folder and reinstall the previous release manually.")


def recover_interrupted(cache, app_root, state):
    """Reconcile a process/power interruption before reporting update state."""
    guard = FileLock(update_root(cache, app_root) / "operation.lock")
    if not guard.acquire():
        return state
    try:
        current = read_json(state_path(cache, app_root)) or state
        if current.get("operation") != state.get("operation"):
            return current
        stage_value = state.get("stageDirectory")
        stage = Path(stage_value).resolve() if isinstance(stage_value, str) else None
        if stage is not None:
            if stage.parent != update_root(cache, app_root) or stage.name != "stage-" + str(state.get("operation", "")):
                raise UpdateError("An interrupted update has an invalid transaction directory.")
            journal = read_json(stage / "journal.json") or {}
            if journal.get("state") == "applying":
                rollback(stage, app_root)
            elif journal.get("state") == "rollback_failed":
                rollback(stage, app_root)
            elif journal.get("state") == "complete":
                manifest = read_json(stage / "update-manifest.json") or {}
                if (manifest.get("version") == state.get("latestVersion") and
                        all(checked_target(app_root, name).is_file() and digest(checked_target(app_root, name)) == expected
                            for name, expected in manifest.get("files", {}).items())):
                    return save_state(cache, {"status": "complete", "currentVersion": manifest["version"], "latestVersion": manifest["version"],
                                              "message": "Update installed. Reloading the extension …", "progress": 1}, app_root)
        return save_state(cache, {**state, "status": "error", "message": "The update was interrupted. Previous application files are retained; check for updates to try again."}, app_root)
    except Exception as error:
        message = str(error) if isinstance(error, UpdateError) else "Interrupted update recovery needs attention. Keep the update backup and reinstall the previous release."
        return save_state(cache, {**state, "status": "error", "message": message}, app_root)
    finally:
        guard.release()
