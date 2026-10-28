"""Explicit export-only, bounded publisher-verification support checks.

Only public metadata/signatures are read. This never downloads a ZIP, starts a
model, changes registration, installs a release, or writes application/cache
files. Ordinary update checks separately retain their last metadata pair so a
later offline export can reproduce the Windows verification failure.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time
import urllib.error
import urllib.request

import updater

MAX_RAW = 512 * 1024
MAX_CACHED = 768 * 1024
MAX_SECONDS = 18


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def _small(path, maximum):
    with Path(path).open("rb") as source:
        raw = source.read(maximum + 1)
    if len(raw) > maximum:
        raise ValueError("support_file_too_large")
    return raw


def _safe_detail(value):
    if not isinstance(value, dict):
        return {}
    result = {}
    for key, pattern in (("step", r"(?:input|key|library|provider|import|verify)"), ("exceptionType", r"[A-Za-z][A-Za-z0-9_.+]{0,159}"),
                         ("powershellVersion", r"[0-9.]{1,32}"), ("languageMode", r"(?:FullLanguage|ConstrainedLanguage|RestrictedLanguage|NoLanguage)"),
                         ("code", r"signature_[a-z_]{1,60}")):
        if isinstance(value.get(key), str) and re.fullmatch(pattern, value[key]):
            result[key] = value[key]
    for key in ("hresult", "exitCode", "ntstatus", "winerror"):
        if type(value.get(key)) is int and -(2**31) <= value[key] < 2**32:
            result[key] = value[key]
    return result




def _cng_probe(raw, signature, public_key, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= .1:
        return {"result": "not_checked", "reason": "deadline_exceeded"}
    started = time.monotonic()
    try:
        updater.verify_signature(raw, signature, public_key, timeout=min(5, remaining))
    except updater.SignatureVerificationError as error:
        result = {"result": {"signature_mismatch": "mismatch", "signature_runtime_error": "runtime_error",
                             "signature_verifier_timeout": "timeout", "signature_verifier_unavailable": "unavailable"}.get(error.code, "unexpected_output"),
                  **_safe_detail(error.verification)}
    except updater.UpdateError:
        result = {"result": "unsupported" if os.name != "nt" else "invalid_signature_encoding"}
    else:
        result = {"result": "valid", "exitCode": 0}
    result["elapsedMilliseconds"] = round((time.monotonic() - started) * 1000)
    return result


def _cached_material(cache, app_root, settings):
    root = updater.update_root(cache, app_root)
    cached = root / "diagnostic-metadata.json"
    try:
        if cached.resolve().is_relative_to(Path(cache).resolve()):
            value = updater.strict_json(_small(cached, MAX_CACHED))
            if value.get("schema") == 1 and value.get("owner") == settings["owner"] and value.get("repository") == settings["repository"]:
                raw = base64.b64decode(value["rawBase64"], validate=True)
                signature = base64.b64decode(value["signatureBase64"], validate=True)
                if len(raw) <= MAX_RAW and len(signature) <= 4096:
                    captured = value.get("capturedAt")
                    info = {"source": "last_update_check", "cachedAt": captured if type(captured) in (int, float) and 0 < captured < 10**12 else None}
                    old_key = value.get("trustedKeySha256")
                    if isinstance(old_key, str) and updater.HASH.fullmatch(old_key):
                        info["capturedKeyMatchesCurrent"] = old_key == _sha(settings["publicKeyXml"].encode("utf-8"))
                    return raw, signature, info
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        pass
    # Older installed versions already retain signed transaction metadata.
    # Read a bounded number of fixed, owned stage names; never follow a path
    # from the exported state or enumerate arbitrary user directories.
    try:
        candidates = []
        with os.scandir(root) as entries:
            for index, entry in enumerate(entries):
                if index >= 64:
                    break
                if re.fullmatch(r"stage-[a-f0-9]{32}", entry.name) and entry.is_dir(follow_symlinks=False):
                    stage = Path(entry.path)
                    if stage.resolve().is_relative_to(root.resolve()):
                        candidates.append(stage)
        for stage in sorted(candidates, key=lambda p: p.stat().st_mtime, reverse=True)[:4]:
            try:
                raw, signature = _small(stage / "update-manifest.json", MAX_RAW), _small(stage / "update-manifest.sig", 4096)
                return raw, signature, {"source": "retained_update_transaction", "cachedAt": (stage / "update-manifest.json").stat().st_mtime}
            except (OSError, ValueError):
                continue
    except OSError:
        pass
    return None


def _download(url, maximum, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= .1:
        raise TimeoutError()
    request = urllib.request.Request(url, headers={"User-Agent": "iKnow-Reading-Helper-Diagnostics/1", "Accept": "application/vnd.github+json" if "api.github.com" in url else "application/octet-stream"})
    opener = urllib.request.build_opener(updater.ReleaseRedirect())
    payload = bytearray()
    with opener.open(request, timeout=max(.1, min(4, remaining))) as response:
        while True:
            if time.monotonic() >= deadline:
                raise TimeoutError()
            block = response.read(min(65536, maximum - len(payload) + 1))
            if not block:
                break
            payload.extend(block)
            if len(payload) > maximum:
                raise ValueError("metadata_too_large")
    return bytes(payload)


def _published_material(settings, deadline):
    endpoint = "https://api.github.com/repos/" + settings["owner"] + "/" + settings["repository"] + "/releases/latest"
    release = updater.strict_json(_download(updater.safe_url(endpoint, settings, api=True), MAX_RAW, deadline))
    if not isinstance(release, dict) or release.get("draft") is not False or release.get("prerelease") is not False or not isinstance(release.get("assets"), list) or len(release["assets"]) > 1000:
        raise ValueError("stable_release_invalid")
    required = {}
    for asset in release["assets"]:
        if isinstance(asset, dict) and asset.get("name") in ("update-manifest.json", "update-manifest.sig"):
            if asset["name"] in required:
                raise ValueError("duplicate_metadata_asset")
            required[asset["name"]] = updater.safe_url(asset.get("browser_download_url"), settings)
    if set(required) != {"update-manifest.json", "update-manifest.sig"}:
        raise ValueError("signed_metadata_missing")
    raw = _download(required["update-manifest.json"], MAX_RAW, deadline)
    signature = _download(required["update-manifest.sig"], 4096, deadline)
    return raw, signature, {"source": "public_github_metadata", "fetchedAt": time.time()}


def collect(cache_root, app_root=updater.APP_ROOT, deadline=None, allow_network=True):
    """Return safe results within one overall budget, including partial checks.

    A deadline also bounds slow system DNS/proxy code that socket timeouts do
    not cover. The read-only worker is daemonized; the dedicated diagnostic
    native connection closes after export. The native CNG verifier runs in process and starts no shell or
    subprocess. Legacy PowerShell checks are explicitly not used.
    """
    started = time.monotonic()
    deadline = min(deadline if deadline is not None else started + MAX_SECONDS, started + MAX_SECONDS)
    report = {"status": "checking", "scope": "Public signed metadata and Windows verifier compatibility only; no archive, setup, model or installation action.",
              "networkAllowed": bool(allow_network), "providers": {"windowsCng": {"result": "not_checked"}, "legacyCsp": {"result": "not_used", "reason": "external_powershell_verifiers_removed"}}}
    lock, finished = threading.Lock(), threading.Event()
    def update(**values):
        with lock:
            report.update(values)
    def run():
        try:
            settings = updater.config(app_root)
            fingerprint = _sha(settings["publicKeyXml"].encode("utf-8"))
            configuration = {"status": "available", "trustedKeySha256": fingerprint}
            try:
                extension = updater.strict_json(_small(Path(app_root) / "extension/update-config.json", 32 * 1024))
                key = extension.get("publicKeyXml")
                if isinstance(key, str):
                    configuration["extensionTrustedKeySha256"] = _sha(key.encode("utf-8"))
                    configuration["helperAndExtensionKeyMatch"] = configuration["extensionTrustedKeySha256"] == fingerprint
                configuration["helperAndExtensionChannelMatch"] = all(extension.get(name) == settings.get(name) for name in ("owner", "repository", "channel", "enabled"))
            except (OSError, ValueError, TypeError, AttributeError):
                configuration["extensionConfigStatus"] = "unavailable"
            update(configuration=configuration)
            material = _cached_material(cache_root, app_root, settings)
            if material is None:
                if not allow_network:
                    update(status="partial", metadata={"status": "unavailable", "reason": "no_cached_metadata_network_disabled"})
                    return
                try:
                    material = _published_material(settings, min(deadline - 3, time.monotonic() + 9))
                except urllib.error.HTTPError as error:
                    update(status="partial", metadata={"status": "unavailable", "reason": "http_error", "httpStatus": error.code})
                    return
                except (OSError, ValueError, updater.UpdateError):
                    update(status="partial", metadata={"status": "unavailable", "reason": "metadata_fetch_failed"})
                    return
            raw, signature, source = material
            try:
                decoded = base64.b64decode(signature.strip(), validate=True)
            except (ValueError, TypeError):
                update(status="partial", metadata={"status": "invalid", "reason": "signature_encoding_invalid", **source})
                return
            if not 256 <= len(decoded) <= 512:
                update(status="partial", metadata={"status": "invalid", "reason": "signature_size_invalid", **source})
                return
            metadata = {"status": "available", **source, "metadataSha256": _sha(raw), "signatureSha256": _sha(decoded), "metadataBytes": len(raw), "signatureBytes": len(decoded)}
            try:
                declared = updater.strict_json(raw)
                if isinstance(declared, dict):
                    declared_version = declared.get("version")
                    if isinstance(declared_version, str) and re.fullmatch(r"[0-9.]{1,32}", declared_version):
                        metadata["declaredVersion"] = declared_version
                    if isinstance(declared.get("files"), dict):
                        metadata["declaredFileCount"] = min(1000000, len(declared["files"]))
            except updater.UpdateError:
                metadata["format"] = "invalid_json"
            update(metadata=metadata)
            if os.name != "nt":
                update(status="partial", providers={name: {"result": "unsupported_platform"} for name in ("windowsCng", "legacyCsp")})
                return
            providers = {"windowsCng": _cng_probe(raw, signature, settings["publicKeyXml"], deadline),
                         "legacyCsp": {"result": "not_used", "reason": "external_powershell_verifiers_removed"}}
            update(providers=providers, status="partial" if providers["windowsCng"].get("result") == "not_checked" else "complete")

        except updater.UpdateError:
            update(status="partial", configuration={"status": "unavailable", "reason": "invalid_update_configuration"})
        except Exception as error:
            detail = {"status": "partial", "reason": "diagnostic_check_failed"}
            typename = type(error).__name__
            if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,79}", typename):
                detail["exceptionType"] = typename
            update(**detail)
        finally:
            finished.set()
    threading.Thread(target=run, name="diagnostic-signature-check", daemon=True).start()
    completed = finished.wait(max(0, deadline - time.monotonic()))
    with lock:
        result = copy.deepcopy(report)
    if not completed:
        result.update(status="partial", reason="overall_deadline_exceeded")
    result["elapsedMilliseconds"] = round((time.monotonic() - started) * 1000)
    return result
