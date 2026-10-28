"""Read-only support probe for older installed Windows signature verifiers.

No imported application code, downloaded code/ZIP, registry or cache writes.
Only the redacted report is written next to this separate support script.
"""
from __future__ import annotations

import argparse
import ast
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

HOST = "de.iknow.lesehilfe"
OWNER, REPOSITORY = "ilyasnsir1", "iknow-reading-helper"
EXPECTED_KEY_SHA256 = "1284c1532f9a09c3799f69ee4315ec73b009e4bb412257885e3e3c2cb1b38d96"
MAX_METADATA = 2 * 1024 * 1024
LEGACY_SCRIPT = "$ErrorActionPreference='Stop';try {$v=[Console]::In.ReadToEnd()|ConvertFrom-Json;$rsa=New-Object Security.Cryptography.RSACryptoServiceProvider;$rsa.PersistKeyInCsp=$false;$rsa.FromXmlString([string]$v.key);$ok=$rsa.VerifyData([Convert]::FromBase64String([string]$v.data),'SHA256',[Convert]::FromBase64String([string]$v.signature));$rsa.Dispose();if($ok){[Console]::Out.Write('VALID');exit 0};exit 2}catch{exit 3}"

CNG_SCRIPT = "$ErrorActionPreference='Stop';$step='input';$rsa=$null;try {\n$v=[Console]::In.ReadToEnd()|ConvertFrom-Json;\n$step='key';$xml=[xml]([string]$v.key);$parameters=New-Object Security.Cryptography.RSAParameters;\n$parameters.Modulus=[Convert]::FromBase64String([string]$xml.RSAKeyValue.Modulus);\n$parameters.Exponent=[Convert]::FromBase64String([string]$xml.RSAKeyValue.Exponent);\n$rsa=New-Object Security.Cryptography.RSACng;$rsa.ImportParameters($parameters);\n$step='verify';$ok=$rsa.VerifyData([Convert]::FromBase64String([string]$v.data),[Convert]::FromBase64String([string]$v.signature),[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1);\nif($ok){[Console]::Out.Write('VALID');exit 0};[Console]::Out.Write('INVALID');exit 2\n}catch{$failure=$_.Exception.GetBaseException();[Console]::Out.Write((@{step=$step;exceptionType=$failure.GetType().FullName;hresult=$failure.HResult;powershellVersion=$PSVersionTable.PSVersion.ToString();languageMode=$ExecutionContext.SessionState.LanguageMode.ToString()}|ConvertTo-Json -Compress));exit 3\n}finally{if($null -ne $rsa){$rsa.Dispose()}}"
LEGACY_DETAILS_SCRIPT = "$ErrorActionPreference='Stop';$step='input';try {$v=[Console]::In.ReadToEnd()|ConvertFrom-Json;$step='key';$rsa=New-Object Security.Cryptography.RSACryptoServiceProvider;$rsa.PersistKeyInCsp=$false;$rsa.FromXmlString([string]$v.key);$step='verify';$ok=$rsa.VerifyData([Convert]::FromBase64String([string]$v.data),'SHA256',[Convert]::FromBase64String([string]$v.signature));$rsa.Dispose();if($ok){[Console]::Out.Write('VALID');exit 0};exit 2}catch{$failure=$_.Exception.GetBaseException();[Console]::Out.Write((@{step=$step;exceptionType=$failure.GetType().FullName;hresult=$failure.HResult;powershellVersion=$PSVersionTable.PSVersion.ToString();languageMode=$ExecutionContext.SessionState.LanguageMode.ToString()}|ConvertTo-Json -Compress));exit 3}"


class ProbeError(ValueError):
    pass


def sha(value):
    return hashlib.sha256(value).hexdigest()


def small_bytes(path, maximum):
    with Path(path).open("rb") as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum:
        raise ProbeError("local_file_too_large")
    return raw


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ProbeError("duplicate_json_key")
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=pairs)
    except (UnicodeError, ValueError, TypeError) as error:
        raise ProbeError("invalid_json") from error


def registered_helper():
    """Resolve the installed helper without running its launcher or source."""
    import winreg
    paths = (("brave", "Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\" + HOST),
             ("chrome", "Software\\Google\\Chrome\\NativeMessagingHosts\\" + HOST))
    for browser, relative in paths:
        for hive, hive_name in ((winreg.HKEY_CURRENT_USER, "hkcu"), (winreg.HKEY_LOCAL_MACHINE, "hklm")):
            for view, view_name in ((winreg.KEY_WOW64_32KEY, "32"), (winreg.KEY_WOW64_64KEY, "64")):
                try:
                    with winreg.OpenKey(hive, relative, 0, winreg.KEY_READ | view) as key:
                        value, kind = winreg.QueryValueEx(key, "")
                except FileNotFoundError:
                    continue
                if kind not in (winreg.REG_SZ, winreg.REG_EXPAND_SZ) or not isinstance(value, str):
                    raise ProbeError("native_registration_invalid")
                manifest = strict_json(small_bytes(Path(os.path.expandvars(value)), 32 * 1024))
                if not isinstance(manifest, dict) or manifest.get("name") != HOST or manifest.get("type") != "stdio":
                    raise ProbeError("native_manifest_invalid")
                launcher = manifest.get("path")
                if not isinstance(launcher, str) or not Path(launcher).is_absolute():
                    raise ProbeError("native_launcher_invalid")
                batch = small_bytes(Path(launcher), 16 * 1024).decode("utf-8-sig")
                commands = re.findall(r'^\s*"[^"\r\n]+"\s+-u\s+"([^"\r\n]+native_host\.py)"\s*$', batch, re.M | re.I)
                if len(commands) != 1:
                    raise ProbeError("native_launcher_format_unrecognized")
                script = Path(commands[0].replace("%%", "%"))
                if not script.is_absolute() or script.name != "native_host.py":
                    raise ProbeError("native_helper_path_invalid")
                return script.parent, {"source": "registry_" + hive_name + "_" + browser + "_" + view_name,
                                       "allowedExtensionCount": len(manifest.get("allowed_origins", [])) if isinstance(manifest.get("allowed_origins"), list) else 0}
    raise ProbeError("native_registration_missing")


def installed_info(helper):
    helper = Path(helper).resolve()
    if (helper / "helper/native_host.py").is_file():
        helper = helper / "helper"
    native = small_bytes(helper / "native_host.py", 256 * 1024).decode("utf-8-sig")
    matched = re.search(r'^HOST_VERSION\s*=\s*[\'"]([0-9]+(?:\.[0-9]+){2,3})[\'"]', native, re.M)
    manifest = strict_json(small_bytes(helper.parent / "extension/manifest.json", 64 * 1024))
    extension_version = manifest.get("version") if isinstance(manifest, dict) else None
    settings = strict_json(small_bytes(helper / "update-config.json", 32 * 1024))
    if not isinstance(settings, dict) or settings.get("owner") != OWNER or settings.get("repository") != REPOSITORY or settings.get("schema") != 1 or settings.get("channel") != "stable" or settings.get("enabled") is not True:
        raise ProbeError("publisher_configuration_unexpected")
    public = settings.get("publicKeyXml")
    if not isinstance(public, str) or not 100 < len(public) < 8192 or not public.startswith("<RSAKeyValue>") or any("<" + name + ">" in public for name in ("D", "P", "Q", "DP", "DQ", "InverseQ")):
        raise ProbeError("publisher_public_key_invalid")
    info = {"helperVersion": matched[1] if matched else "unknown", "extensionVersion": extension_version if isinstance(extension_version, str) and re.fullmatch(r"[0-9.]{1,32}", extension_version) else "unknown",
            "trustedKeySha256": sha(public.encode("utf-8")), "expectedTrustedKeySha256": EXPECTED_KEY_SHA256,
            "trustedKeyMatchesPublished": sha(public.encode("utf-8")) == EXPECTED_KEY_SHA256}
    try:
        tree = ast.parse(small_bytes(helper / "updater.py", 256 * 1024))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "verify_signature")
        script = next(node.value.value for node in ast.walk(function) if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "script" for target in node.targets) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str))
        info.update(installedVerifierScriptSha256=sha(script.encode("utf-8")), installedVerifierMatchesLegacy=script == LEGACY_SCRIPT)
    except (OSError, ValueError, StopIteration, SyntaxError):
        info["installedVerifierMatchesLegacy"] = None
    return settings, info


def asset_url(value):
    parts = urllib.parse.urlsplit(str(value))
    prefix = "/" + OWNER + "/" + REPOSITORY + "/releases/download/"
    if parts.scheme != "https" or parts.hostname != "github.com" or parts.username or parts.password or parts.port not in (None, 443) or parts.fragment or not parts.path.startswith(prefix) or ".." in urllib.parse.unquote(parts.path).split("/"):
        raise ProbeError("release_asset_address_invalid")
    return str(value)


class ReleaseRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        target = urllib.parse.urlsplit(newurl)
        if target.scheme != "https" or target.username or target.password or target.port not in (None, 443) or target.hostname not in {"github.com", "api.github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com", "github-releases.githubusercontent.com"}:
            raise ProbeError("release_redirect_unexpected")
        return super().redirect_request(request, fp, code, message, headers, newurl)


def download(url, maximum):
    request = urllib.request.Request(url, headers={"User-Agent": "iKnow-Reading-Helper-Support/1", "Accept": "application/vnd.github+json" if "api.github.com" in url else "application/octet-stream"})
    started, payload = time.monotonic(), bytearray()
    opener = urllib.request.build_opener(ReleaseRedirect())
    with opener.open(request, timeout=20) as response:
        declared = response.headers.get("Content-Length")
        if declared and (not declared.isdigit() or int(declared) > maximum):
            raise ProbeError("release_metadata_too_large")
        while True:
            block = response.read(min(65536, maximum - len(payload) + 1))
            if not block:
                break
            payload.extend(block)
            if len(payload) > maximum:
                raise ProbeError("release_metadata_too_large")
            if time.monotonic() - started > 90:
                raise ProbeError("release_metadata_timeout")
        if declared and int(declared) != len(payload):
            raise ProbeError("release_metadata_interrupted")
    return bytes(payload)


def published_material():
    release = strict_json(download("https://api.github.com/repos/" + OWNER + "/" + REPOSITORY + "/releases/latest", MAX_METADATA))
    if not isinstance(release, dict) or release.get("draft") is not False or release.get("prerelease") is not False or not isinstance(release.get("assets"), list) or len(release["assets"]) > 1000:
        raise ProbeError("stable_release_invalid")
    required = {}
    for item in release["assets"]:
        if isinstance(item, dict) and item.get("name") in {"update-manifest.json", "update-manifest.sig"}:
            if item["name"] in required:
                raise ProbeError("duplicate_release_asset")
            required[item["name"]] = asset_url(item.get("browser_download_url"))
    if set(required) != {"update-manifest.json", "update-manifest.sig"}:
        raise ProbeError("signed_metadata_missing")
    raw = download(required["update-manifest.json"], MAX_METADATA)
    signature = download(required["update-manifest.sig"], 4096)
    try:
        decoded = base64.b64decode(signature.strip(), validate=True)
    except (ValueError, TypeError) as error:
        raise ProbeError("signature_encoding_invalid") from error
    if not 256 <= len(decoded) <= 512:
        raise ProbeError("signature_size_invalid")
    return raw, decoded


def windows_probe(script, payload):
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    try:
        result = subprocess.run(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], input=payload,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=25, creationflags=subprocess.CREATE_NO_WINDOW)
    except subprocess.TimeoutExpired:
        return {"result": "timeout"}
    except OSError:
        return {"result": "unavailable"}
    report = {"exitCode": result.returncode, "result": "valid" if result.returncode == 0 and result.stdout == b"VALID" else "mismatch" if result.returncode == 2 and result.stdout in (b"", b"INVALID") else "runtime_error" if result.returncode == 3 else "unexpected_output"}
    # stderr and arbitrary exception messages may contain local paths, account
    # names or policy details; only whitelisted structured facts are exported.
    if result.returncode == 3 and len(result.stdout) <= 4096:
        try:
            detail = strict_json(result.stdout)
        except ProbeError:
            detail = {}
        if isinstance(detail, dict):
            for key, pattern in (("step", r"(?:input|key|verify)"), ("exceptionType", r"[A-Za-z][A-Za-z0-9_.+]{0,159}"),
                                 ("powershellVersion", r"[0-9.]{1,32}"), ("languageMode", r"(?:FullLanguage|ConstrainedLanguage|RestrictedLanguage|NoLanguage)")):
                if isinstance(detail.get(key), str) and re.fullmatch(pattern, detail[key]):
                    report[key] = detail[key]
            if type(detail.get("hresult")) is int and -(2**31) <= detail["hresult"] < 2**32:
                report["hresult"] = detail["hresult"]
    return report


def collect(helper=None):
    if os.name != "nt":
        raise ProbeError("windows_required")
    if helper is None:
        helper, registration = registered_helper()
    else:
        registration = {"source": "explicit_folder"}
    settings, installed = installed_info(helper)
    raw, signature = published_material()
    payload = json.dumps({"key": settings["publicKeyXml"], "data": base64.b64encode(raw).decode("ascii"), "signature": base64.b64encode(signature).decode("ascii")}).encode("ascii")
    legacy = windows_probe(LEGACY_SCRIPT, payload)
    probes = {"legacyExact": legacy, "cng": windows_probe(CNG_SCRIPT, payload)}
    if legacy["result"] != "valid":
        probes["legacyDetails"] = windows_probe(LEGACY_DETAILS_SCRIPT, payload)
    return {"format": "iknow-reader-update-support", "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
            "registration": registration, "installed": installed,
            "published": {"metadataSha256": sha(raw), "signatureSha256": sha(signature), "metadataBytes": len(raw), "signatureBytes": len(signature)},
            "verification": probes,
            "scope": "Read-only registration/configuration and public signed metadata checks. No application/cache changes, ZIP downloads, private keys, raw logs or paths."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--helper", type=Path, help="Optional explicit helper/application folder; otherwise use native registration.")
    args = parser.parse_args()
    print("Checking the installed public update key and Windows verification ...")
    try:
        report = collect(args.helper)
    except ProbeError as error:
        report = {"format": "iknow-reader-update-support", "schemaVersion": 1, "error": str(error)}
    except (OSError, ValueError, UnicodeError):
        report = {"format": "iknow-reader-update-support", "schemaVersion": 1, "error": "probe_could_not_complete"}
    target = Path(__file__).resolve().with_name("iKnow-update-check-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + ".json")
    try:
        with target.open("x", encoding="utf-8") as output:
            json.dump(report, output, ensure_ascii=False, indent=2)
            output.write("\n")
    except OSError:
        print("The report could not be saved next to this script. Please move this support folder to a writable location.")
        return 1
    print("Report saved next to this script: " + target.name)
    print("Please share that JSON report with the project maintainer. Nothing was installed or updated.")
    return int("error" in report)


if __name__ == "__main__":
    raise SystemExit(main())
