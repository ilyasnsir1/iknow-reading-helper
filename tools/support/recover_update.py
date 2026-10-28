"""Explicit, offline repair of an installed updater blocked by security software.

The default --check is read only. --apply requires a terminal and typed UPDATE.
The separate recovery folder supplies trusted updater code; no installed or
archive Python code is executed, and no release is downloaded by this tool.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import uuid
import zipfile

sys.dont_write_bytecode = True
HOST = "de.iknow.lesehilfe"
OWNER, REPOSITORY = "ilyasnsir1", "iknow-reading-helper"
EXPECTED_KEY_SHA256 = "1284c1532f9a09c3799f69ee4315ec73b009e4bb412257885e3e3c2cb1b38d96"


class RecoveryError(ValueError):
    pass


def load_updater():
    """Load only the explicitly supplied recovery library or development source."""
    here = Path(__file__).resolve().parent
    source = here / "updater.py"
    if not source.is_file() and here.name == "support" and here.parent.name == "tools":
        source = here.parents[1] / "helper/updater.py"
    if not source.is_file():
        raise RecoveryError("The recovery folder is incomplete: updater.py is missing.")
    specification = importlib.util.spec_from_file_location("iknow_offline_recovery_updater", source)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def small_bytes(path, maximum):
    with Path(path).open("rb") as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum:
        raise RecoveryError("A recovery input is larger than its allowed limit.")
    return raw


def safe_path(path, *, directory=False):
    """Reject links/junctions before resolving them, including existing parents."""
    absolute = Path(os.path.abspath(path))
    for part in reversed((absolute, *absolute.parents)):
        if part.exists() or part.is_symlink():
            attributes = part.lstat()
            if part.is_symlink() or getattr(attributes, "st_file_attributes", 0) & 0x400:
                raise RecoveryError("Recovery cannot use a linked or redirected folder.")
    if directory and not absolute.is_dir():
        raise RecoveryError("A required recovery folder does not exist: " + str(absolute))
    return absolute.resolve()


def registered_helper():
    """Read native registration and its launcher without executing installed code."""
    import winreg
    paths = ("Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\" + HOST,
             "Software\\Google\\Chrome\\NativeMessagingHosts\\" + HOST)
    for relative in paths:
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            for view in (winreg.KEY_WOW64_32KEY, winreg.KEY_WOW64_64KEY):
                try:
                    with winreg.OpenKey(hive, relative, 0, winreg.KEY_READ | view) as key:
                        value, kind = winreg.QueryValueEx(key, "")
                except FileNotFoundError:
                    continue
                if kind not in (winreg.REG_SZ, winreg.REG_EXPAND_SZ) or not isinstance(value, str):
                    raise RecoveryError("The native helper registration is invalid.")
                manifest = json.loads(small_bytes(safe_path(os.path.expandvars(value)), 32 * 1024))
                if not isinstance(manifest, dict) or manifest.get("name") != HOST or manifest.get("type") != "stdio":
                    raise RecoveryError("The registered helper manifest is invalid.")
                launcher = manifest.get("path")
                if not isinstance(launcher, str) or not Path(launcher).is_absolute():
                    raise RecoveryError("The registered helper launcher is invalid.")
                batch = small_bytes(safe_path(launcher), 16 * 1024).decode("utf-8-sig")
                commands = re.findall(r'^\s*"[^"\r\n]+"\s+-u\s+"([^"\r\n]+native_host\.py)"\s*$', batch, re.M | re.I)
                if len(commands) != 1:
                    raise RecoveryError("The registered helper launcher format is not recognized.")
                script = Path(commands[0].replace("%%", "%"))
                if not script.is_absolute() or script.name != "native_host.py":
                    raise RecoveryError("The registered helper source path is invalid.")
                return safe_path(script).parent
    raise RecoveryError("The existing helper registration was not found. No installation was changed.")


def default_cache():
    return Path(os.environ.get("IKNOW_READER_CACHE", str(Path(os.environ.get("LOCALAPPDATA", Path.home())) / "iKnowLesehilfe")))


def brave_is_running():
    """Read the Windows process snapshot; never stop or change any process."""
    if os.name != "nt":
        raise RecoveryError("Offline updater recovery requires Windows.")
    from ctypes import wintypes
    class ProcessEntry(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD),
                    ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_size_t),
                    ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
                    ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG),
                    ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260)]
    kernel = ctypes.WinDLL("kernel32.dll", use_last_error=True, winmode=0x800)
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    for name in ("Process32FirstW", "Process32NextW"):
        function = getattr(kernel, name)
        function.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
        function.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot in (None, ctypes.c_void_p(-1).value):
        raise RecoveryError("Windows could not confirm that Brave is closed. Try again after closing Brave.")
    try:
        entry = ProcessEntry()
        entry.dwSize = ctypes.sizeof(entry)
        if not kernel.Process32FirstW(snapshot, ctypes.byref(entry)):
            raise RecoveryError("Windows could not read the process list. No application files were changed.")
        while True:
            if entry.szExeFile.casefold() == "brave.exe":
                return True
            if not kernel.Process32NextW(snapshot, ctypes.byref(entry)):
                if ctypes.get_last_error() != 18:
                    raise RecoveryError("Windows could not finish reading the process list.")
                return False
    finally:
        kernel.CloseHandle(snapshot)


def verify_permissions(before, after):
    for field in ("permissions", "host_permissions", "optional_permissions", "optional_host_permissions"):
        previous, upcoming = before.get(field, []), after.get(field, [])
        if not isinstance(previous, list) or not isinstance(upcoming, list) or any(not isinstance(value, str) for value in previous + upcoming):
            raise RecoveryError("The extension permissions are invalid.")
        if not set(upcoming).issubset(previous):
            raise RecoveryError("This recovery release adds browser permissions and cannot be applied automatically.")
    try:
        old_matches = {value for script in before.get("content_scripts", []) for value in script.get("matches", [])}
        new_matches = {value for script in after.get("content_scripts", []) for value in script.get("matches", [])}
    except (TypeError, AttributeError) as error:
        raise RecoveryError("The extension website access list is invalid.") from error
    if not new_matches.issubset(old_matches) or after.get("externally_connectable") != before.get("externally_connectable"):
        raise RecoveryError("This recovery release changes website access or external connections.")


def inspect_archive(updater, archive, manifest, installed_manifest):
    """Equivalent read-only archive checks: every file streams through SHA256."""
    seen, expanded, important = set(), 0, {}
    required = {"extension/manifest.json", "helper/native_host.py", "RELEASE-FILES.json"}
    with zipfile.ZipFile(archive) as bundle:
        if len(bundle.infolist()) > updater.MAX_FILES + 100:
            raise RecoveryError("The archive contains too many entries.")
        for entry in bundle.infolist():
            if entry.is_dir():
                updater.managed_path(entry.filename.rstrip("/") + "/directory-entry.txt")
                continue
            name = entry.filename
            updater.managed_path(name)
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode) or (mode and stat.S_IFMT(mode) not in {0, stat.S_IFREG}):
                raise RecoveryError("The recovery archive contains a linked or special file.")
            if name not in manifest["files"] or name.casefold() in seen or entry.flag_bits & 1:
                raise RecoveryError("The recovery archive does not match its signed file list.")
            if entry.file_size < 0 or entry.file_size > updater.MAX_FILE:
                raise RecoveryError("A recovery archive file is too large.")
            expanded += entry.file_size
            if expanded > updater.MAX_EXPANDED:
                raise RecoveryError("The expanded recovery archive is too large.")
            digest, count, content = hashlib.sha256(), 0, bytearray()
            with bundle.open(entry) as stream:
                for block in iter(lambda: stream.read(128 * 1024), b""):
                    count += len(block)
                    if count > entry.file_size or count > updater.MAX_FILE:
                        raise RecoveryError("A recovery file exceeded its declared size.")
                    digest.update(block)
                    if name in required:
                        content.extend(block)
            if count != entry.file_size or digest.hexdigest() != manifest["files"][name]:
                raise RecoveryError("A recovery file failed its integrity check.")
            seen.add(name.casefold())
            if name in required:
                important[name] = bytes(content)
    if seen != {name.casefold() for name in manifest["files"]}:
        raise RecoveryError("The recovery archive is missing signed files.")
    extension = updater.strict_json(important["extension/manifest.json"])
    if extension.get("version") != manifest["version"] or extension.get("manifest_version") != 3:
        raise RecoveryError("The extension version does not match the signed recovery release.")
    host = important["helper/native_host.py"].decode("utf-8")
    if not re.search(r'^HOST_VERSION\s*=\s*[\'"]' + re.escape(manifest["helperVersion"]) + r'[\'"]\s*$', host, re.M):
        raise RecoveryError("The helper version does not match the signed recovery release.")
    baseline = updater.strict_json(important["RELEASE-FILES.json"])
    expected = {name: digest for name, digest in manifest["files"].items() if name != "RELEASE-FILES.json"}
    if baseline.get("version") != manifest["version"] or baseline.get("sha256") != expected:
        raise RecoveryError("The signed recovery baseline does not match its files.")
    verify_permissions(installed_manifest, extension)


def preflight(app, cache, release, updater):
    app, cache, release = (safe_path(path, directory=True) for path in (app, cache, release))
    if app == cache or app.is_relative_to(cache) or cache.is_relative_to(app):
        raise RecoveryError("The application and learning cache must be separate folders.")
    settings = updater.config(app)
    public = settings["publicKeyXml"]
    if settings["owner"] != OWNER or settings["repository"] != REPOSITORY or hashlib.sha256(public.encode("utf-8")).hexdigest() != EXPECTED_KEY_SHA256:
        raise RecoveryError("The installed publisher key does not match this recovery tool. No files were changed.")
    raw = small_bytes(safe_path(release / "update-manifest.json"), updater.MAX_METADATA)
    signature = small_bytes(safe_path(release / "update-manifest.sig"), 4096)
    updater.verify_signature(raw, signature, public)
    host = small_bytes(updater.checked_target(app, "helper/native_host.py"), 512 * 1024).decode("utf-8-sig")
    matched = re.search(r'^HOST_VERSION\s*=\s*[\'"]([0-9]+(?:\.[0-9]+){2,3})[\'"]', host, re.M)
    if not matched:
        raise RecoveryError("The installed helper version could not be read.")
    current = updater.current_version(app)
    manifest = updater.validate_manifest(raw, settings, current, matched[1])
    if updater.version(manifest["version"]) <= updater.version(current):
        raise RecoveryError("Recovery requires a newer release than the installed application.")
    name = manifest["asset"]["name"]
    if Path(name).name != name:
        raise RecoveryError("The signed recovery archive name is invalid.")
    archive = safe_path(release / name)
    if not archive.is_file() or archive.stat().st_size != manifest["asset"]["size"] or updater.digest(archive) != manifest["asset"]["sha256"]:
        raise RecoveryError("The local recovery archive failed its signed size or SHA256 check.")
    updater.validate_baseline(app, manifest)
    before = updater.strict_json(small_bytes(updater.checked_target(app, "extension/manifest.json"), 256 * 1024))
    inspect_archive(updater, archive, manifest, before)
    safe_path(updater.update_root(cache, app))
    return {"app": app, "cache": cache, "release": release, "settings": settings, "current": current,
            "manifest": manifest, "raw": raw, "signature": signature, "archive": archive, "helperVersion": matched[1]}


def recover(app, cache, release, *, apply=False, stdin=None, stdout=None):
    updater = load_updater()
    plan = preflight(app, cache, release, updater)
    output, source = stdout or sys.stdout, stdin or sys.stdin
    print("Existing application: " + str(plan["app"]), file=output)
    print("Verified offline update: " + plan["current"] + " -> " + plan["manifest"]["version"], file=output)
    print("The existing folder, browser registration, models and learning data are retained.", file=output)
    if not apply:
        print("Check complete. No files were written. Run Recover-update.cmd to install this verified update.", file=output)
        return plan["manifest"]
    if not source.isatty():
        raise RecoveryError("Installation requires an interactive terminal and typed UPDATE. No files were changed.")
    if brave_is_running():
        raise RecoveryError("Close Brave completely, including background windows, then run recovery again.")
    print("Preparation must be paused and Brave completely closed. Type UPDATE to install, or anything else to cancel:", file=output, flush=True)
    if source.readline().strip() != "UPDATE":
        raise RecoveryError("Recovery was cancelled. No files were changed.")
    # Revalidate all inputs after the human has reviewed the exact target.
    confirmed = plan
    plan = preflight(app, cache, release, updater)
    if any(plan[key] != confirmed[key] for key in ("app", "cache", "current", "raw")):
        raise RecoveryError("The application or signed release changed after confirmation. Review it by running recovery again.")
    if brave_is_running():
        raise RecoveryError("Brave opened again. Close it completely and run recovery again.")
    guard = updater.FileLock(updater.update_root(plan["cache"], plan["app"]) / "operation.lock")
    locks = []
    stage, installing = None, False
    try:
        if not guard.acquire():
            raise RecoveryError("Another update check or installation is running. Try again after it finishes.")
        locks = updater.activity_locks(plan["cache"])
        if brave_is_running():
            raise RecoveryError("Brave is running. No application files were changed.")
        state = updater.read_json(updater.state_path(plan["cache"], plan["app"])) or {}
        if any(updater.pid_alive(state.get(name)) for name in ("ownerPid", "runnerPid")):
            raise RecoveryError("An existing updater is still running. Wait for it to finish.")
        operation = uuid.uuid4().hex
        stage = updater.update_root(plan["cache"], plan["app"]) / ("stage-" + operation)
        safe_path(stage)
        stage.mkdir(parents=True, exist_ok=False)
        updater.atomic_json(stage / "stage-owner.json", {"schema": 1, "appRoot": str(plan["app"]), "cacheRoot": str(plan["cache"]),
                                                        "operation": operation, "ownerPid": os.getpid()})
        archive = stage / "application.zip"
        shutil.copyfile(plan["archive"], archive)
        if archive.stat().st_size != plan["manifest"]["asset"]["size"] or updater.digest(archive) != plan["manifest"]["asset"]["sha256"]:
            raise RecoveryError("The recovery archive changed after verification. No application files were changed.")
        updater.extract_archive(archive, stage / "files", plan["manifest"])
        updater.validate_baseline(plan["app"], plan["manifest"])
        updater.validate_permissions(plan["app"], stage / "files")
        (stage / "update-manifest.json").write_bytes(plan["raw"])
        (stage / "update-manifest.sig").write_bytes(plan["signature"])
        updater.atomic_json(stage / "transaction.json", {"schema": 1, "appRoot": str(plan["app"]), "cacheRoot": str(plan["cache"]),
                            "operation": operation, "parentPid": 0, "helperVersion": plan["helperVersion"],
                            "publicKeyXml": plan["settings"]["publicKeyXml"], "owner": OWNER, "repository": REPOSITORY})
        updater.save_state(plan["cache"], {"status": "installing", "operation": operation, "ownerPid": os.getpid(),
                           "stageDirectory": str(stage), "currentVersion": plan["current"], "latestVersion": plan["manifest"]["version"],
                           "message": "Installing the verified offline update ...", "progress": .98}, plan["app"])
        installing = True
        result = updater.transaction_apply(stage)
        updater.save_state(plan["cache"], {"status": "complete", "currentVersion": result["version"], "latestVersion": result["version"],
                           "message": "Offline update installed. Reopen Brave and refresh iKnow pages.", "progress": 1}, plan["app"])
        print("Update installed. Reopen Brave, reopen the extension popup, then choose Refresh iKnow pages.", file=output)
        return result
    except Exception:
        if installing:
            updater.save_state(plan["cache"], {"status": "error", "currentVersion": updater.current_version(plan["app"]),
                               "latestVersion": plan["manifest"]["version"], "message": "Offline recovery could not finish. Keep the recovery transaction folder for support."}, plan["app"])
        raise
    finally:
        for lock in reversed(locks):
            lock.release()
        guard.release()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Verify without writing files (default).")
    mode.add_argument("--apply", action="store_true", help="Require terminal confirmation, then install into the existing folder.")
    parser.add_argument("--app", type=Path, help="Explicit existing application folder; otherwise read the native registration.")
    parser.add_argument("--cache", type=Path, help="Existing learning cache; otherwise use the normal helper cache setting.")
    parser.add_argument("--release", type=Path, default=Path(__file__).resolve().parent / "release", help="Local folder containing the signed release assets.")
    args = parser.parse_args(argv)
    try:
        app = args.app if args.app is not None else registered_helper().parent
        recover(app, args.cache if args.cache is not None else default_cache(), args.release, apply=args.apply)
        return 0
    except (RecoveryError, ValueError, OSError, UnicodeError, zipfile.BadZipFile) as error:
        print("Recovery stopped: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
