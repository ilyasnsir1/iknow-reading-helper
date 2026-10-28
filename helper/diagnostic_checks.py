"""Read-only, bounded local checks for a complete support export.

No process/model is started. Application paths remain local; the report uses
opaque identities and fixed component labels instead of personal file names.
"""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import urllib.request

import updater
from process_resources import worker_threads

MAX_BASELINE_BYTES = 256 * 1024
MAX_HASH_BYTES = 32 * 1024 * 1024
MAX_HASH_FILES = 512
VERSION = re.compile(r"[0-9]+(?:\.[0-9]+){2,3}\Z")
HOST = "de.iknow.lesehilfe"


def identity(path):
    return hashlib.sha256(os.path.normcase(str(Path(path).resolve())).encode("utf-8")).hexdigest()[:24]


def small_json(path, limit=64 * 1024):
    try:
        with Path(path).open("rb") as stream:
            raw = stream.read(limit + 1)
        if len(raw) > limit:
            return None
        value = json.loads(raw.decode("utf-8-sig"))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, UnicodeError):
        return None


def error_code(error):
    result = {"type": type(error).__name__}
    for name in ("errno", "winerror"):
        value = getattr(error, name, None)
        if type(value) is int:
            result[name] = value
    return result


def resources(root, app_root):
    result = {"logicalCpuCount": min(1024, os.cpu_count() or 1), "workerThreadLimit": worker_threads()}
    result["threadEnvironment"] = {name: int(os.environ[name]) for name in
        ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS")
        if re.fullmatch(r"[0-9]{1,4}", os.environ.get(name, ""))}
    disks = {}
    for label, base in (("cache", root), ("application", app_root)):
        while not base.exists() and base != base.parent:
            base = base.parent
        try:
            usage = shutil.disk_usage(base)
            disks[label] = {"status": "available", "totalMiB": usage.total // (1024**2), "freeMiB": usage.free // (1024**2)}
        except OSError as error:
            disks[label] = {"status": "unavailable", "error": error_code(error)}
    result["disk"] = disks
    if os.name == "nt":
        class MemoryStatus(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [(name, ctypes.c_ulonglong) for name in
                ("totalPhysical", "availablePhysical", "totalPage", "availablePage", "totalVirtual", "availableVirtual", "extendedVirtual")]
        class ProcessMemory(ctypes.Structure):
            _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong)] + [(name, ctypes.c_size_t) for name in
                ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]
        try:
            status = MemoryStatus()
            status.length = ctypes.sizeof(status)
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            if not kernel.GlobalMemoryStatusEx(ctypes.byref(status)):
                raise ctypes.WinError(ctypes.get_last_error())
            result["memory"] = {"status": "available", "totalPhysicalMiB": status.totalPhysical // (1024**2),
                                "availablePhysicalMiB": status.availablePhysical // (1024**2), "loadPercent": status.load}
            counters = ProcessMemory()
            counters.cb = ctypes.sizeof(counters)
            kernel.GetCurrentProcess.restype = ctypes.c_void_p
            psapi = ctypes.WinDLL("psapi", use_last_error=True)
            psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
            if psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
                result["currentHelperProcess"] = {"workingSetMiB": counters.WorkingSetSize // (1024**2),
                                                   "peakWorkingSetMiB": counters.PeakWorkingSetSize // (1024**2)}
        except (OSError, AttributeError) as error:
            result.setdefault("memory", {"status": "unavailable", "error": error_code(error)})
    else:
        result["memory"] = {"status": "unsupported_platform"}
    try:
        proxies = urllib.request.getproxies()
        result["proxy"] = {"status": "available", "configuredSchemes": [name for name in ("http", "https", "all") if proxies.get(name)],
                           "environmentProxyPresent": any(os.environ.get(name) for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")),
                           "modelLoopbackUsesSystemProxy": False}
    except (OSError, ValueError):
        result["proxy"] = {"status": "unavailable", "modelLoopbackUsesSystemProxy": False}
    return result


def application(app_root, helper_version):
    extension = small_json(app_root / "extension/manifest.json")
    version = extension.get("version") if extension else None
    return {"identity": identity(app_root), "helperVersion": helper_version,
            "extensionVersion": version if isinstance(version, str) and VERSION.fullmatch(version) else None,
            "extensionManifest": "readable" if extension else "unavailable"}


def managed_integrity(app_root, deadline=None):
    baseline = small_json(app_root / "RELEASE-FILES.json", MAX_BASELINE_BYTES)
    if baseline is None or not isinstance(baseline.get("sha256"), dict):
        return {"status": "baseline_unavailable", "checkedFiles": 0, "truncated": False}
    files = baseline["sha256"]
    result = {"status": "available", "baselineVersion": baseline.get("version") if VERSION.fullmatch(str(baseline.get("version", ""))) else None,
              "declaredFiles": len(files), "checkedFiles": 0, "readBytes": 0, "missing": [], "modified": [], "unreadable": [],
              "truncated": False, "invalidEntries": 0}
    priority = {"helper/native_host.py": 0, "helper/updater.py": 1, "helper/diagnostics.py": 2, "helper/engine.py": 3,
                "extension/manifest.json": 4, "extension/background.js": 5, "extension/diagnostics-background.js": 6}
    for name, expected in sorted(files.items(), key=lambda entry: (priority.get(entry[0], 100), str(entry[0]))):
        if result["checkedFiles"] >= MAX_HASH_FILES or deadline is not None and time.monotonic() >= deadline:
            result.update(truncated=True, incompleteReason="time_or_file_budget")
            break
        try:
            if not isinstance(name, str) or not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected):
                raise ValueError()
            relative = updater.managed_path(name)
            target = updater.checked_target(app_root, str(relative))
        except (ValueError, OSError):
            result["invalidEntries"] += 1
            continue
        try:
            size = target.stat().st_size
            if result["readBytes"] + size > MAX_HASH_BYTES:
                result.update(truncated=True, incompleteReason="byte_budget")
                continue
            hasher = hashlib.sha256()
            with target.open("rb") as stream:
                for block in iter(lambda: stream.read(128 * 1024), b""):
                    result["readBytes"] += len(block)
                    if result["readBytes"] > MAX_HASH_BYTES:
                        raise ValueError("byte_budget")
                    hasher.update(block)
            if hasher.hexdigest() != expected:
                result["modified"].append(name)
            result["checkedFiles"] += 1
        except FileNotFoundError:
            result["missing"].append(name)
            result["checkedFiles"] += 1
        except OSError:
            result["unreadable"].append(name)
            result["checkedFiles"] += 1
        except ValueError:
            result.update(truncated=True, incompleteReason="byte_budget")
            break
    for key in ("modified", "missing", "unreadable"):
        if len(result[key]) > 60:
            result[key] = result[key][:60]
            result["truncated"] = True
    result["matchesBaseline"] = not any(result[key] for key in ("modified", "missing", "unreadable", "invalidEntries")) and not result["truncated"]
    result["baselineAuthenticity"] = "local_record_only; publisher signature is checked separately"
    return result


def runtime(root):
    config = small_json(root / "runtime-config.json")
    result = {"configuration": "readable" if config is not None else "unavailable", "components": {}}
    config = config or {}
    result["gpuLayers"] = config.get("gpuLayers", 99) if type(config.get("gpuLayers", 99)) is int and 0 <= config.get("gpuLayers", 99) <= 999 else None
    components = (("languageExecutable", "llamaExecutable", "runtime/llama/llama-server.exe"),
                  ("languageModel", "llamaModel", "models/Qwen3.5-9B-Q4_K_M.gguf"),
                  ("audioModel", "whisperModel", "models/whisper-small"),
                  ("audioDependencies", "dependencies", "python-packages"),
                  ("privatePython", None, "runtime/python/python.exe"),
                  ("voiceExecutable", None, "neural/runtime/Windows-x64/run.exe"))
    for label, key, default in components:
        raw = config.get(key) if key else None
        configured = isinstance(raw, str) and bool(raw)
        path = Path(raw) if configured else root / default
        try:
            stat = path.stat()
            result["components"][label] = {"status": "present", "configured": configured, "kind": "directory" if path.is_dir() else "file",
                                             "sizeBytes": stat.st_size if path.is_file() else None,
                                             "location": "cache" if path.resolve().is_relative_to(root) else "external"}
        except FileNotFoundError:
            result["components"][label] = {"status": "missing", "configured": configured}
        except (OSError, ValueError) as error:
            result["components"][label] = {"status": "unavailable", "configured": configured, "error": error_code(error)}
    for name, minimum, maximum in (("gpuLayers", 0, 999), ("whisperThreads", 1, 1024), ("whisperWorkers", 1, 128)):
        if type(config.get(name)) is int and minimum <= config[name] <= maximum:
            result[name] = config[name]
    return result


def registration(app_root):
    if os.name != "nt":
        return {"status": "unsupported_platform", "entries": []}
    import winreg
    entries = []
    for browser, path in (("brave", r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts" + "\\" + HOST),
                          ("chrome", r"Software\Google\Chrome\NativeMessagingHosts" + "\\" + HOST)):
        for hive, hive_name in ((winreg.HKEY_CURRENT_USER, "user"), (winreg.HKEY_LOCAL_MACHINE, "machine")):
            for view, view_name in ((winreg.KEY_WOW64_32KEY, "32"), (winreg.KEY_WOW64_64KEY, "64")):
                item = {"browser": browser, "scope": hive_name, "view": view_name}
                try:
                    with winreg.OpenKey(hive, path, 0, winreg.KEY_READ | view) as key:
                        value, kind = winreg.QueryValueEx(key, "")
                    if kind not in (winreg.REG_SZ, winreg.REG_EXPAND_SZ) or not isinstance(value, str):
                        item["status"] = "invalid_registration"
                    else:
                        manifest = small_json(Path(os.path.expandvars(value)), 32 * 1024)
                        if not manifest or manifest.get("name") != HOST or manifest.get("type") != "stdio":
                            item["status"] = "manifest_unavailable"
                        else:
                            launcher = manifest.get("path")
                            if not isinstance(launcher, str) or not Path(launcher).is_absolute():
                                item["status"] = "invalid_launcher"
                            else:
                                with Path(launcher).open("rb") as stream:
                                    batch = stream.read(16 * 1024 + 1)
                                matches = re.findall(r'^\s*"[^"\r\n]+"\s+-u\s+"([^"\r\n]+native_host\.py)"\s*$', batch.decode("utf-8-sig"), re.M | re.I) if len(batch) <= 16 * 1024 else []
                                if len(matches) != 1:
                                    item["status"] = "launcher_unrecognized"
                                else:
                                    native = Path(matches[0].replace("%%", "%"))
                                    item.update(status="available", helperExists=native.is_file(),
                                                helperIdentity=identity(native.parent.parent),
                                                matchesRunningApplication=native.resolve() == (app_root / "helper/native_host.py").resolve())
                                    origins = manifest.get("allowed_origins")
                                    item["allowedExtensionCount"] = len(origins) if isinstance(origins, list) else 0
                                    item["allowedExtensionFingerprints"] = [hashlib.sha256(value.encode()).hexdigest()[:24] for value in origins[:20]
                                        if isinstance(value, str) and re.fullmatch(r"chrome-extension://[a-p]{32}/", value)] if isinstance(origins, list) else []
                    entries.append(item)
                except FileNotFoundError:
                    continue
                except (OSError, UnicodeError, ValueError) as error:
                    entries.append({**item, "status": "unavailable", "error": error_code(error)})
    return {"status": "available" if entries else "missing", "entries": entries}


def collect(cache_root, app_root=updater.APP_ROOT, helper_version="unknown"):
    root, app_root = Path(cache_root).resolve(), Path(app_root).resolve()
    result = {}
    for name, check in (("application", lambda: application(app_root, helper_version)),
                        ("registration", lambda: registration(app_root)),
                        ("resources", lambda: resources(root, app_root)),
                        ("runtime", lambda: runtime(root)),
                        ("managedFiles", lambda: managed_integrity(app_root, time.monotonic() + 3))):
        try:
            result[name] = check()
        except (OSError, ValueError, TypeError, AttributeError) as error:
            result[name] = {"status": "unavailable", "error": error_code(error)}
    return result
