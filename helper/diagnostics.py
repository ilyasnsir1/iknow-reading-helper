"""Bounded, read-only support information; never loads models or starts jobs.

Only fixed diagnostic logs and small status/installation fields are exported.
Course text, word requests, audio, full configuration and cache files are not
included. Presence checks are deliberately not an installation verification.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import platform
import re
import sys
import time

import diagnostic_checks
import support_events
import updater

SCHEMA_VERSION = 1
MAX_JSON = 64 * 1024
MAX_LOG_READ = 32 * 1024
MAX_TOTAL_LOG_READ = 192 * 1024
MAX_REPORT = 512 * 1024
FIXED_LOGS = (
    "logs/setup-latest.log", "logs/llama.log", "logs/llama.previous.log", "neural/engine.log",
    "neural/supervisor.log", "neural/course-jobs/worker.log",
    "components/worker.log", "components/install.log",
)
PACKAGE_NAMES = {"numpy", "av", "ctranslate2", "faster-whisper", "onnxruntime",
                 "tokenizers", "huggingface-hub", "requests", "pyopenjtalk-plus"}
INTERESTING = re.compile(r"error|warning|exception|traceback|failed|failure|time[ -]?out|timed out|missing|setup complete|installation|interrupted|cancelled", re.I)
TECHNICAL = re.compile(r"(?:\b(?:loading|loaded|ready|listening|starting|started|stopped|memory|threads?|backend|device|vulkan|cuda|ggml|llama|duration|exit code)\b|^\s*File [\"']|^\s*(?:Caused by|Traceback|[a-zA-Z_.]+(?:Error|Exception):))", re.I)
LEARNING_FIELD = re.compile(r"[\"']?\b(?:text|kana|reading|japanese|sentence|prompt|response|source|word|words)\b[\"']?\s*[:=]", re.I)
CREDENTIAL = re.compile(r"\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|authorization|secret|token)\b[\"']?\s*[:=]", re.I)
JAPANESE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaffー々〆〇]+")
VERSION = re.compile(r"[A-Za-z0-9][A-Za-z0-9.!+_-]{0,63}\Z")


def _inside(path, root):
    try:
        return path.resolve().is_relative_to(root)
    except (OSError, RuntimeError, ValueError):
        return False


def _file(root, relative):
    path = root / relative
    try:
        return path if _inside(path, root) and path.is_file() else None
    except OSError:
        return None


def _read_json(root, relative):
    path = _file(root, relative)
    try:
        if path is None or path.stat().st_size > MAX_JSON:
            return None
        value = json.loads(path.read_bytes().decode("utf-8-sig"))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, UnicodeError):
        return None


def _redactor(root):
    paths = [str(root)] + [os.environ.get(name, "") for name in
                          ("USERPROFILE", "HOME", "LOCALAPPDATA", "APPDATA", "TEMP", "TMP")]
    paths = sorted({value.rstrip("/\\") for value in paths if len(value) > 3}, key=len, reverse=True)
    identities = [os.environ.get(name, "") for name in ("USERNAME", "USER", "COMPUTERNAME")]

    def redact(value, limit=350):
        text = str(value).replace("\x00", "")
        if LEARNING_FIELD.search(text):
            return "[learning/request content omitted]"
        if CREDENTIAL.search(text) or re.search(r"\bbearer\s+\S+|--(?:api[-_]?key|token|password|secret)\s+", text, re.I):
            return "[credential-bearing diagnostic line omitted]"
        # URLs may contain credentials, user names and query tokens. Omit the
        # complete URL instead of attempting to recognize each secret name.
        text = re.sub(r"https?://[^\s<>\"']+", "[url]", text, flags=re.I)
        for path in paths:
            variants = {path, path.replace("\\", "/"), path.replace("/", "\\")}
            for variant in sorted(variants, key=len, reverse=True):
                text = re.sub(re.escape(variant), "[local-path]", text, flags=re.I)
        text = re.sub(r"([\"'])(?:[A-Za-z]:[\\/]|/|\\\\)[^\"'\r\n]+\1", "'[path]'", text)
        text = re.sub(r"(?:[A-Za-z]:[\\/]|\\\\)[^\"'\r\n<>|]+", "[path]", text)
        text = re.sub(r"(?<![\w:])/(?:[^/\s\"']+/)+[^\s\"']*", "[path]", text)
        for identity in identities:
            if len(identity) >= 3:
                text = re.sub(r"(?<!\w)" + re.escape(identity) + r"(?!\w)", "[user]", text, flags=re.I)
        text = JAPANESE.sub("[Japanese text]", text)
        text = re.sub(r"[^\S\n]+", " ", text)
        text = "".join(character for character in text if character.isprintable() or character == "\n")
        return text.strip()[:limit]
    return redact


def _log(root, relative, budget, redact):
    result = {"name": relative, "status": "missing", "lines": [], "truncated": False}
    path = _file(root, relative)
    if path is None:
        return result, 0
    if budget <= 0:
        result.update(status="omitted", truncated=True)
        return result, 0
    try:
        size = path.stat().st_size
        amount = min(size, MAX_LOG_READ, budget)
        with path.open("rb") as source:
            header = source.read(2)
            encoding = "utf-16-le" if header == b"\xff\xfe" else "utf-16-be" if header == b"\xfe\xff" else "utf-8-sig"
            offset = max(0, size - amount)
            if encoding.startswith("utf-16") and offset % 2:
                offset += 1
            source.seek(offset)
            raw = source.read(amount)
        text = raw.decode(encoding, errors="replace").lstrip("\ufeff")
        if size > amount and "\n" in text:
            text = text.split("\n", 1)[1]
        lines = [(index + 1, line) for index, line in enumerate(text.splitlines()) if INTERESTING.search(line) or TECHNICAL.search(line)]
        result.update(status="available", lines=[redact(line) for _, line in lines[-80:]],
                      tailLineNumbers=[index for index, _ in lines[-80:]],
                      context="Bounded technical/error context; arbitrary learning/request lines are omitted.",
                      truncated=size > amount or len(lines) > 80)
        return result, len(raw)
    except OSError:
        result["status"] = "unreadable"
        return result, 0


def _entries(root, relative, maximum=200):
    directory = root / relative
    try:
        if not _inside(directory, root) or not directory.is_dir():
            return []
        values = []
        with os.scandir(directory) as iterator:
            for entry in iterator:
                if len(values) >= maximum:
                    break
                path = Path(entry.path)
                if _inside(path, root):
                    values.append(path)
        def modified(path):
            try:
                return path.stat().st_mtime_ns
            except OSError:
                return 0
        return sorted(values, key=modified, reverse=True)
    except OSError:
        return []


def _packages(root):
    result = {}
    for entry in _entries(root, "python-packages", 512):
        if not entry.name.endswith(".dist-info") or not entry.is_dir():
            continue
        path = _file(root, str((entry / "METADATA").relative_to(root)))
        if path is None:
            continue
        try:
            with path.open("rb") as source:
                header = source.read(16 * 1024).decode("utf-8", errors="replace")
            name = re.search(r"^Name: ([^\r\n]+)", header, re.M)
            version = re.search(r"^Version: ([^\r\n]+)", header, re.M)
            normalized = re.sub(r"[-_.]+", "-", name[1]).lower() if name else ""
            if normalized in PACKAGE_NAMES and version and VERSION.fullmatch(version[1]):
                result[normalized] = version[1]
        except (OSError, ValueError):
            continue
    return result


def _small_status(value, redact):
    result = {}
    for key in ("status", "stage", "code"):
        item = value.get(key)
        if isinstance(item, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", item):
            result[key] = item
    for key in ("completed", "total", "ready", "failed", "updatedAt", "startedAt", "lastProgressAt", "durationMs"):
        item = value.get(key)
        if type(item) in (int, float) and math.isfinite(item) and 0 <= item <= 10**15:
            result[key] = item
    if isinstance(value.get("message"), str):
        result["message"] = redact(value["message"], 300)
    for key in ("jobKey", "requestKey"):
        if isinstance(value.get(key), str) and re.fullmatch(r"[a-f0-9]{20}", value[key]):
            result[key] = value[key]
    if isinstance(value.get("features"), dict):
        result["features"] = {key: value["features"].get(key) is True for key in ("german", "colors", "audio")}
    failure = support_events.safe_failure(value.get("failure"))
    if failure:
        result["failure"] = failure
    return result


def collect(cache_root, helper_version, *, active_checks=False, app_root=None):
    """Collect project support evidence; explicit active checks never install."""
    started = time.monotonic()
    root = Path(cache_root).resolve()
    app = Path(app_root).resolve() if app_root is not None else updater.APP_ROOT
    redact = _redactor(root)
    setup = _read_json(root, "setup-state.json") or {}
    marker = _read_json(root, "neural/installation.json") or {}
    selected = setup.get("selected") if isinstance(setup.get("selected"), dict) else {}
    setup_status = {"selected": {name: selected.get(name) is True for name in ("course", "neural", "legacy")}}
    if type(setup.get("completed")) is bool:
        setup_status["completed"] = setup["completed"]
    if setup.get("lastMode") in ("Complete", "Voices", "Repair"):
        setup_status["lastMode"] = setup["lastMode"]
    if isinstance(setup.get("lastAttemptAt"), str) and re.fullmatch(r"[0-9TZ:.+-]{10,40}", setup["lastAttemptAt"]):
        setup_status["lastAttemptAt"] = setup["lastAttemptAt"]
    capabilities = {
        "checkType": "presence-only; files are not hashed and models are not loaded",
        "privatePythonPresent": bool(_file(root, "runtime/python/python.exe")),
        "courseRuntimePresent": bool(_file(root, "runtime/llama/llama-server.exe")),
        "courseConfigReadable": _read_json(root, "runtime-config.json") is not None,
        "courseModelPresent": bool(_file(root, "models/Qwen3.5-9B-Q4_K_M.gguf")),
        "voiceRuntimePresent": bool(_file(root, "neural/runtime/Windows-x64/run.exe")),
        "voiceMarkerReadable": bool(marker),
        "voicesMarked": [name for name in ("female", "male") if isinstance(marker.get("voices"), list) and name in marker["voices"]],
        "packages": _packages(root),
    }
    if isinstance(marker.get("engineVersion"), str) and VERSION.fullmatch(marker["engineVersion"]):
        capabilities["voiceEngineVersion"] = marker["engineVersion"]
    logs, budget = [], MAX_TOTAL_LOG_READ
    relatives = list(FIXED_LOGS)
    # Current jobs share worker.log; tolerate up to three later per-job logs
    # without permitting arbitrary paths or reading request/cache files.
    for directory in _entries(root, "neural/course-jobs", 200):
        if directory.is_dir() and re.fullmatch(r"[a-f0-9]{64}", directory.name):
            relative = str((directory / "worker.log").relative_to(root)).replace("\\", "/")
            if _file(root, relative):
                relatives.append(relative)
                if len(relatives) >= len(FIXED_LOGS) + 3:
                    break
    for relative in relatives:
        log, consumed = _log(root, relative, budget, redact)
        # Do not disclose per-job fingerprints as exported file names.
        if re.search(r"/[a-f0-9]{64}/", log["name"]):
            log["name"] = "neural/course-jobs/[job]/worker.log"
        logs.append(log); budget -= consumed
    jobs = []
    scanned = {}
    for kind, folder, pattern in (("course", "jobs", r"([1-9][0-9]{0,8})\.json"),
                                   ("word", "neural/course-jobs", r"[a-f0-9]{64}\.state\.json")):
        candidates = _entries(root, folder, 1000)
        scanned[kind] = {"directoryEntriesScanned": len(candidates), "scanLimitReached": len(candidates) >= 1000}
        for path in candidates:
            matched = re.fullmatch(pattern, path.name)
            if not matched:
                continue
            value = _read_json(root, str(path.relative_to(root)))
            if value is not None:
                item = {"kind": kind, **_small_status(value, redact)}
                if kind == "course":
                    item["courseId"] = matched[1]
                jobs.append(item)
    jobs.sort(key=lambda item: item.get("updatedAt", 0), reverse=True)
    report = {"schemaVersion": SCHEMA_VERSION,
              "diagnosticFormatVersion": 2,
              "helperVersion": helper_version if isinstance(helper_version, str) and VERSION.fullmatch(helper_version) else "unknown",
              "platform": {"system": platform.system(), "release": redact(platform.release(), 80), "pythonVersion": sys.version.split()[0]},
              "capabilities": capabilities, "setup": setup_status, "logs": logs, "jobs": jobs[:100],
              "updates": updater.diagnostic_snapshot(root, app),
              "localChecks": diagnostic_checks.collect(root, app, helper_version=helper_version),
              "events": support_events.read_recent(root, limit=160),
              "limits": {"logTailBytesPerFile": MAX_LOG_READ, "totalLogReadBytes": MAX_TOTAL_LOG_READ,
                         "jobStatusFilesScannedPerKind": 1000, "exportedJobs": 100, "jobScans": scanned,
                         "matchingJobsFound": len(jobs), "jobsTruncated": len(jobs) > 100, "maxReportBytes": MAX_REPORT},
              "scope": "Project-only local support evidence, structured history, bounded technical logs and file checks; no learning caches, audio, model contents or personal paths."}
    if active_checks:
        try:
            import update_diagnostics
            report["updates"]["activeCheck"] = update_diagnostics.collect(root, app_root=app, deadline=time.monotonic() + 20, allow_network=True)
        except (ImportError, OSError, ValueError, TypeError) as error:
            report["updates"]["activeCheck"] = {"status": "unavailable", "error": diagnostic_checks.error_code(error)}
    try:
        import component_manager
        components = component_manager.snapshot(root)
        job = components.get("job") or {}
        safe_job = _small_status(job, redact)
        for key in ("componentId", "phase"):
            if isinstance(job.get(key), str) and re.fullmatch(r"[a-z][a-z0-9_-]{0,79}", job[key]):
                safe_job[key] = job[key]
        for key in ("downloadedBytes", "totalBytes", "fileIndex", "fileCount", "progress", "etaSeconds"):
            if type(job.get(key)) in (int, float) and math.isfinite(job[key]) and 0 <= job[key] <= 10**15:
                safe_job[key] = job[key]
        report["components"] = {"catalogVersion": components["catalogVersion"], "active": components["active"],
                                "components": components["components"], "job": safe_job}
    except (OSError, ValueError, TypeError) as error:
        report["components"] = {"status": "unavailable", "error": diagnostic_checks.error_code(error)}
    report["collection"] = {"activeChecksRequested": active_checks is True, "durationMs": round((time.monotonic() - started) * 1000),
                            "modelsStarted": False, "preparationStarted": False, "updatesInstalled": False}
    while len(json.dumps(report, ensure_ascii=False).encode("utf-8")) > MAX_REPORT:
        log = next((entry for entry in reversed(logs) if entry["lines"]), None)
        if log is None:
            if len(report["events"].get("events", [])) > 20:
                report["events"]["events"] = report["events"]["events"][20:]
                report["events"]["truncated"] = True
            elif len(report["jobs"]) > 20:
                report["jobs"] = report["jobs"][:-10]
                report["limits"]["jobsTruncated"] = True
            else:
                break
        else:
            log["lines"].pop()
            if log.get("tailLineNumbers"):
                log["tailLineNumbers"].pop()
            log["truncated"] = True
        report["reportTruncated"] = True
    return report
