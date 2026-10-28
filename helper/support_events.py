"""Small persistent diagnostic history containing only explicitly typed facts.

Diagnostics must never prevent preparation or expose course text, credentials,
paths, command lines or request payloads. These files have a fixed size budget;
read_recent performs no writes and never imports or loads any model runtime.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import math
import os
from pathlib import Path
import re
import threading
import time

MAX_FILE_BYTES = 256 * 1024
MAX_EVENT_BYTES = 4096
MAX_EXPORT_EVENTS = 160
MAX_LOCK_SECONDS = .15
_thread_lock = threading.Lock()
_APP_MODULES = {"native_host", "engine", "acoustic", "phoneme_alignment", "process_resources",
                "word_speech", "neural_speech", "word_voice_jobs", "updater", "update_runner"}
_IDENTIFIER = re.compile(r"[a-zA-Z_][a-zA-Z0-9_.-]{0,95}\Z")
_STRINGS = {"component", "event", "status", "stage", "code", "reason", "method"}
_NUMBERS = {"completed", "total", "ready", "failed", "durationMs", "timeoutSeconds", "maxTokens",
            "workerThreads", "childPid", "childExitCode", "lastProgressAt", "startedAt", "cacheHits",
            "modelBytes", "gpuLayers",
            "playbackSpeed",
            "translated", "audioAccepted", "audioExcluded", "translationExcluded", "wordExcluded", "groupsExcluded"}
_BOOLEANS = {"cached", "partial", "interim", "cancelled", "ownedChild"}


def correlation(value):
    """A stable opaque reference; the underlying native request is never kept."""
    if value is None:
        return None
    return hashlib.sha256(str(value).encode("utf-8", errors="replace")).hexdigest()[:20]


def exception_info(error):
    """Keep exception types/numeric causes and internal frame locations only."""
    chain, frames, seen = [], [], set()
    current = error
    while isinstance(current, BaseException) and id(current) not in seen and len(chain) < 4:
        seen.add(id(current))
        name = type(current).__module__ + "." + type(current).__name__
        entry = {"type": name if re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_.]{0,159}", name) else "unknown"}
        for key in ("errno", "winerror"):
            number = getattr(current, key, None)
            if type(number) is int and -(2**31) <= number < 2**32:
                entry[key] = number
        status = getattr(current, "code", None)
        if type(status) is int and 100 <= status <= 599:
            entry["httpStatus"] = status
        chain.append(entry)
        trace = current.__traceback__
        while trace:
            code = trace.tb_frame.f_code
            module = Path(code.co_filename).stem
            if module in _APP_MODULES and _IDENTIFIER.fullmatch(code.co_name):
                frame = {"module": module, "function": code.co_name, "line": trace.tb_lineno}
                if frame not in frames:
                    frames.append(frame)
            trace = trace.tb_next
        current = current.__cause__ or current.__context__ or getattr(current, "reason", None)
    return {"type": chain[0]["type"] if chain else "unknown", "chain": chain, "frames": frames[-8:]}


def safe_failure(value):
    """Revalidate disk data before it becomes part of an exported report."""
    if not isinstance(value, dict):
        return None
    result, chain, frames = {}, [], []
    name = value.get("type")
    if isinstance(name, str) and re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_.]{0,159}", name):
        result["type"] = name
    for entry in (value.get("chain") or [])[:4] if isinstance(value.get("chain"), list) else []:
        if not isinstance(entry, dict):
            continue
        name = entry.get("type")
        if not isinstance(name, str) or not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_.]{0,159}", name):
            continue
        item = {"type": name}
        for key in ("errno", "winerror", "httpStatus"):
            number = entry.get(key)
            if type(number) is int and -(2**31) <= number < 2**32:
                item[key] = number
        chain.append(item)
    for frame in (value.get("frames") or [])[-8:] if isinstance(value.get("frames"), list) else []:
        if not isinstance(frame, dict):
            continue
        if frame.get("module") in _APP_MODULES and isinstance(frame.get("function"), str) and _IDENTIFIER.fullmatch(frame["function"]) and type(frame.get("line")) is int and 0 < frame["line"] < 100000:
            frames.append({"module": frame["module"], "function": frame["function"], "line": frame["line"]})
    result.update(chain=chain, frames=frames)
    return result


def safe_event(value):
    if not isinstance(value, dict):
        return None
    result = {}
    for key in _STRINGS:
        item = value.get(key)
        if isinstance(item, str) and _IDENTIFIER.fullmatch(item):
            result[key] = item
    if "component" not in result or "event" not in result:
        return None
    for key in _NUMBERS | {"at"}:
        item = value.get(key)
        if type(item) in (int, float) and math.isfinite(item) and -(2**31) <= item <= 10**15:
            result[key] = item
    for key in _BOOLEANS:
        if type(value.get(key)) is bool:
            result[key] = value[key]
    if value.get("voice") in ("female", "male"):
        result["voice"] = value["voice"]
    if re.fullmatch(r"[1-9][0-9]{0,8}", str(value.get("courseId", ""))):
        result["courseId"] = str(value["courseId"])
    for key in ("jobKey", "requestKey"):
        item = value.get(key)
        if isinstance(item, str) and re.fullmatch(r"[a-f0-9]{20}", item):
            result[key] = item
    features = value.get("features")
    if isinstance(features, dict):
        result["features"] = {name: features.get(name) is True for name in ("german", "colors", "audio")}
    failure = safe_failure(value.get("failure"))
    if failure:
        result["failure"] = failure
    return result


def _directory(root, create=False):
    root = Path(root).resolve()
    directory = root / "support"
    if not directory.resolve().is_relative_to(root) or directory.is_symlink():
        raise OSError("Support directory is linked.")
    if create:
        directory.mkdir(parents=True, exist_ok=True)
    return directory


@contextlib.contextmanager
def _lock(directory):
    """Coordinate threads and independently spawned native hosts briefly."""
    with _thread_lock:
        path = directory / "events.lock"
        if path.is_symlink() or not path.resolve().is_relative_to(directory.resolve()):
            raise OSError("Support lock is linked.")
        with path.open("a+b") as stream:
            if not stream.tell():
                stream.write(b"0"); stream.flush()
            deadline = time.monotonic() + MAX_LOCK_SECONDS
            while True:
                stream.seek(0)
                try:
                    if os.name == "nt":
                        import msvcrt
                        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(.005)
            try:
                yield
            finally:
                stream.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def append(root, component, event, **fields):
    """Best-effort append; a diagnostic I/O failure never fails the operation."""
    try:
        value = safe_event({**fields, "component": component, "event": event, "at": int(time.time() * 1000)})
        if value is None:
            return False
        raw = (json.dumps(value, ensure_ascii=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")
        if len(raw) > MAX_EVENT_BYTES:
            return False
        directory = _directory(root, create=True)
        current, previous = directory / "events.ndjson", directory / "events.previous.ndjson"
        with _lock(directory):
            for path in (current, previous):
                if path.is_symlink() or not path.resolve().is_relative_to(directory.resolve()):
                    return False
            if current.exists() and current.stat().st_size + len(raw) > MAX_FILE_BYTES:
                os.replace(current, previous)
            with current.open("ab") as out:
                out.write(raw)
        return True
    except (OSError, ValueError, TypeError, RuntimeError):
        return False


def read_recent(root, limit=MAX_EXPORT_EVENTS):
    """Return bounded chronological facts; missing history remains explicit."""
    limit = max(1, min(MAX_EXPORT_EVENTS, int(limit)))
    result = {"status": "missing", "events": [], "truncated": False,
              "limits": {"eventFiles": 2, "bytesPerFile": MAX_FILE_BYTES, "exportedEvents": limit}}
    try:
        directory = _directory(root)
        records, count, present = [], 0, False
        for name in ("events.previous.ndjson", "events.ndjson"):
            path = directory / name
            if not path.exists():
                continue
            if path.is_symlink() or not path.resolve().is_relative_to(directory.resolve()):
                result["status"] = "unavailable"
                return result
            present = True
            with path.open("rb") as stream:
                size = path.stat().st_size
                if size > MAX_FILE_BYTES:
                    stream.seek(size - MAX_FILE_BYTES)
                    stream.readline(MAX_EVENT_BYTES + 1)
                    result["truncated"] = True
                raw = stream.read(MAX_FILE_BYTES)
            for line in raw.splitlines():
                if len(line) > MAX_EVENT_BYTES:
                    result["truncated"] = True
                    continue
                try:
                    event = safe_event(json.loads(line))
                except (ValueError, UnicodeError, TypeError):
                    continue
                if event:
                    count += 1
                    records.append(event)
        records.sort(key=lambda item: item.get("at", 0))
        result.update(status="available" if present else "missing", events=records[-limit:], truncated=result["truncated"] or count > limit)
        return result
    except (OSError, ValueError, RuntimeError):
        result["status"] = "unavailable"
        return result


class Recorder:
    def __init__(self, root, component, **context):
        self.root, self.component, self.context = Path(root), component, context

    def child(self, component):
        return Recorder(self.root, component, **self.context)

    def record(self, event, **fields):
        return append(self.root, self.component, event, **{**self.context, **fields})

    def error(self, event, error, **fields):
        return self.record(event, **{**fields, "failure": exception_info(error)})


def from_emit(root, emit, component):
    owner = getattr(emit, "__self__", None)
    recorder = getattr(owner, "journal", None)
    return recorder.child(component) if isinstance(recorder, Recorder) else Recorder(root, component)
