"""Explicit, detached per-course preparation of the existing neural word cache.

Only validated descriptors from the same pronunciation code as word playback
are accepted. Jobs never import the course model/Whisper, fetch source data or
return audio payloads. A stopped process can resume from completed WAV files.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import threading
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
import neural_speech as neural

MAX_WORDS = 2000
MAX_JSON = 2_000_000
STATUSES = {"starting", "running", "paused", "complete", "partial", "error"}


class JobError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _directory(root):
    return Path(root) / "neural" / "course-jobs"


def _job_id(value):
    if not isinstance(value, str) or re.fullmatch(r"[a-f0-9]{64}", value) is None:
        raise ValueError("Invalid word preparation job ID.")
    return value


def _paths(root, job_id):
    job_id = _job_id(job_id)
    directory = _directory(root)
    return {name: directory / (job_id + suffix) for name, suffix in (
        ("request", ".request.json"), ("state", ".state.json"), ("pause", ".pause"), ("lock", ".lock"))}


def _read(path):
    try:
        if path.stat().st_size > MAX_JSON:
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        return None


def _atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f".{os.getpid()}.{threading.get_ident()}.tmp")
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if len(data.encode("utf-8")) > MAX_JSON:
        raise ValueError("Word preparation checkpoint is too large.")
    try:
        temporary.write_text(data, encoding="utf-8")
        for attempt in range(12):
            try:
                os.replace(temporary, path)
                return
            except PermissionError:
                if attempt == 11:
                    raise
                time.sleep(.01 * (attempt + 1))
    finally:
        temporary.unlink(missing_ok=True)


def validated_request(message):
    if not isinstance(message, dict) or message.get("manual") is not True:
        raise ValueError("Start word voice preparation explicitly on the course page.")
    course = message.get("courseId")
    if isinstance(course, bool) or re.fullmatch(r"[1-9][0-9]{0,8}", str(course)) is None:
        raise ValueError("Invalid word preparation course ID.")
    signature = message.get("sourceSignature")
    if not isinstance(signature, str) or re.fullmatch(r"(?:[a-f0-9]{8}|[a-f0-9]{64})", signature) is None:
        raise ValueError("Invalid course source signature.")
    voice = neural.clean_voice(message.get("voice"))
    speed = neural.clean_speed(message.get("speed"))
    words = message.get("words")
    if not isinstance(words, list) or not 1 <= len(words) <= MAX_WORDS:
        raise ValueError("Choose between 1 and 2,000 word pronunciations for one course.")
    descriptors, keys = [], set()
    for value in words:
        if not isinstance(value, dict):
            raise ValueError("Invalid word pronunciation descriptor.")
        reading = neural.clean_kana(value.get("text"))
        written = neural.clean_japanese(value.get("japanese"), reading)
        key = neural._cache_key(reading, written, speed, voice)
        if key not in keys:
            keys.add(key)
            descriptors.append({"text": reading, "japanese": written, "key": key})
    identity = {"courseId": str(course), "voice": voice, "speed": speed, "sourceSignature": signature,
                "voiceVersion": neural.VERSION, "keys": sorted(keys)}
    job_id = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"schemaVersion": 1, "jobId": job_id, **{key: value for key, value in identity.items() if key != "keys"}, "words": descriptors}


def _saved_request(root, job_id):
    value = _read(_paths(root, job_id)["request"])
    if not isinstance(value, dict):
        raise JobError("word_prepare_not_found", "This word preparation job was not found. Start it again on the course page.")
    request = validated_request({**value, "manual": True})
    if request["jobId"] != job_id or value.get("voiceVersion") != neural.VERSION:
        raise JobError("word_prepare_outdated", "The selected voice or course data changed. Start word voice preparation again.")
    return request


def cached(root, descriptor):
    """Check the same exact cache key/PCM structure without reading base64 audio."""
    path = Path(root) / "neural" / "words" / (descriptor["key"] + ".wav")
    try:
        size = path.stat().st_size
        if not 100 <= size <= neural.MAX_BYTES:
            return False
        with path.open("rb") as source:
            header = source.read(44)
        if len(header) != 44 or header[:4] != b"RIFF" or header[8:16] != b"WAVEfmt " or header[36:40] != b"data":
            return False
        chunk, fmt, format_, channels, rate, byte_rate, align, bits, data_size = (
            struct.unpack_from("<I", header, 4)[0], struct.unpack_from("<I", header, 16)[0],
            *struct.unpack_from("<HHIIHH", header, 20), struct.unpack_from("<I", header, 40)[0])
        return (chunk == size - 8 and fmt == 16 and format_ == 1 and channels == 1 and rate == neural.SAMPLE_RATE and
                byte_rate == rate * 2 and align == 2 and bits == 16 and data_size == size - 44 and data_size % 2 == 0 and
                .04 <= data_size / (rate * 2) <= neural.MAX_DURATION)
    except (OSError, ValueError, struct.error):
        return False


def _active(root, job_id):
    lock = neural.FileLock(_paths(root, job_id)["lock"])
    try:
        return not lock.acquire()
    finally:
        lock.release()


def _public(request, state):
    total = len(request["words"])
    ready = max(0, min(total, int(state.get("ready", 0))))
    failed = max(0, min(total - ready, int(state.get("failed", 0))))
    remaining = state.get("remainingSeconds")
    if type(remaining) not in (int, float) or not math.isfinite(remaining) or remaining < 0:
        remaining = None
    status = state.get("status") if state.get("status") in STATUSES else "paused"
    return {"jobId": request["jobId"], "courseId": request["courseId"], "voice": request["voice"], "speed": request["speed"],
            "status": status, "ready": ready, "total": total, "failed": failed, "remainingSeconds": remaining,
            "message": str(state.get("message", ""))[:300]}


def _coverage(root, request, state):
    ready_keys = {word["key"] for word in request["words"] if cached(root, word)}
    prior_failures = state.get("failures", {})
    failures = {key: str(value)[:200] for key, value in prior_failures.items() if key not in ready_keys} if isinstance(prior_failures, dict) else {}
    return ready_keys, failures


def status(root, job_id):
    request = _saved_request(root, _job_id(job_id))
    state = _read(_paths(root, job_id)["state"]) or {}
    if not isinstance(state, dict):
        state = {}
    if _active(root, job_id):
        return _public(request, state)
    ready_keys, failures = _coverage(root, request, state)
    count = len(ready_keys)
    previous = state.get("status")
    if count == len(request["words"]):
        value, message = "complete", "Word voice is ready."
    elif previous == "error":
        value, message = "error", state.get("message", "Preparation stopped. Resume to retry missing words.")
    elif previous in {"complete", "partial"}:
        value, message = "partial", "Some word recordings are missing. Resume to prepare only the missing words."
    else:
        value, message = "paused", "Preparation paused. Completed word recordings are retained."
    return _public(request, {**state, "status": value, "ready": count, "failed": len(failures), "remainingSeconds": 0 if value == "complete" else None, "message": message})


def start(root, message):
    request = validated_request(message)
    job_id = request["jobId"]
    paths = _paths(root, job_id)
    directory = _directory(root)
    directory.mkdir(parents=True, exist_ok=True)
    launch = neural.FileLock(directory / "launch.lock")
    if not launch.acquire(5):
        raise JobError("word_prepare_busy", "Another word preparation is starting. Please try again.")
    try:
        if _active(root, job_id):
            return status(root, job_id)
        old = _read(paths["state"]) or {}
        ready_keys, failures = _coverage(root, request, old if isinstance(old, dict) else {})
        if len(ready_keys) == len(request["words"]):
            _atomic(paths["request"], request)
            _atomic(paths["state"], {"status": "complete", "ready": len(ready_keys), "failed": 0, "remainingSeconds": 0, "message": "Word voice is ready.", "updatedAt": time.time()})
            return status(root, job_id)
        if not neural.installed(root):
            raise JobError("word_neural_missing", "Install the local neural voices with helper/Setup.cmd before preparing word audio.")
        worker = neural.FileLock(directory / "worker.lock")
        try:
            if not worker.acquire():
                raise JobError("word_prepare_busy", "Another course's word voice is being prepared. Pause it first.")
        finally:
            worker.release()
        token = uuid.uuid4().hex
        _atomic(paths["request"], request)
        paths["pause"].unlink(missing_ok=True)
        state = {"status": "starting", "ready": len(ready_keys), "failed": len(failures), "failures": failures,
                 "remainingSeconds": None, "message": "Starting local word voice preparation ...", "updatedAt": time.time(), "workerToken": token}
        _atomic(paths["state"], state)
        with neural._open_log(directory / "worker.log") as log:
            child = subprocess.Popen([sys.executable, "-u", str(Path(__file__).resolve()), "_run", "--cache-root", str(Path(root).resolve()), "--job-id", job_id, "--token", token],
                                     stdin=subprocess.DEVNULL, stdout=log, stderr=log, close_fds=True, **neural._hidden_options())
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            current = _read(paths["state"])
            if isinstance(current, dict) and current.get("workerToken") == token and current.get("status") != "starting":
                return _public(request, current)
            if child.poll() is not None:
                raise JobError("word_prepare_failed", "The word preparation worker could not start. See neural/course-jobs/worker.log.")
            time.sleep(.05)
        # Acquiring the per-job lock precedes expensive imports/synthesis, so a
        # correctly launched worker normally acknowledges within a fraction sec.
        if _active(root, job_id):
            return _public(request, state)
        raise JobError("word_prepare_failed", "The word preparation worker did not start. Please try again.")
    finally:
        launch.release()


def pause(root, job_id):
    job_id = _job_id(job_id)
    request = _saved_request(root, job_id)
    if _active(root, job_id):
        _paths(root, job_id)["pause"].touch()
        state = status(root, job_id)
        state["message"] = "Pausing after the current word ..."
        return state
    return status(root, job_id)


def run(root, job_id, token):
    request = _saved_request(root, job_id)
    paths = _paths(root, job_id)
    worker = neural.FileLock(_directory(root) / "worker.lock")
    own = neural.FileLock(paths["lock"])
    state = _read(paths["state"]) or {}
    if not isinstance(state, dict):
        state = {}
    if state.get("workerToken") != token:
        return  # An earlier launch must not change a newer launch's checkpoint.
    owns_job = False
    def save():
        state["updatedAt"] = time.time()
        _atomic(paths["state"], state)
    try:
        if not worker.acquire() or not own.acquire():
            return  # Never overwrite the worker that actually owns these locks.
        owns_job = True
        current = _read(paths["state"])
        if not isinstance(current, dict) or current.get("workerToken") != token:
            return
        state = current
        state.update(status="running", remainingSeconds=None, message="Preparing word voice ...")
        ready_keys, failures = _coverage(root, request, state)
        state.update(ready=len(ready_keys), failed=len(failures), failures=failures)
        save()
        if not neural.warm_import():
            raise neural.NeuralError("word_neural_missing", "The local audio libraries are unavailable. Run helper/Setup.cmd and choose Check / repair.")
        durations, attempted = [], 0
        for word in request["words"]:
            if paths["pause"].exists():
                state.update(status="paused", remainingSeconds=None, message="Preparation paused. Completed word recordings are retained.")
                save(); return
            if cached(root, word):
                ready_keys.add(word["key"]); failures.pop(word["key"], None)
                continue
            started = time.monotonic()
            try:
                neural.synthesize(word["text"], request["speed"], root, voice=request["voice"], japanese=word["japanese"])
                if not cached(root, word):
                    raise ValueError("The generated word recording was not saved correctly.")
                ready_keys.add(word["key"]); failures.pop(word["key"], None)
            except neural.NeuralError:
                raise
            except Exception as error:
                failures[word["key"]] = str(error)[:200] or "The word could not be prepared."
            attempted += 1
            if attempted > 1:
                durations.append(time.monotonic() - started)
                durations = durations[-16:]
            remaining = len(request["words"]) - len(ready_keys) - len(failures)
            eta = math.ceil(remaining * sum(durations) / len(durations)) if len(durations) >= 3 else None
            state.update(ready=len(ready_keys), failed=len(failures), failures=failures, remainingSeconds=eta,
                         message="Preparing word voice ...")
            save()
            # The foreground voice checks the same synthesis lock every50ms.
            # Yield between new words so a click can acquire it before the next
            # background request, instead of waiting for an entire course.
            time.sleep(.08)
        ready_keys, failures = _coverage(root, request, state)
        complete = len(ready_keys) == len(request["words"])
        state.update(status="complete" if complete else "partial", ready=len(ready_keys), failed=len(failures), failures=failures,
                     remainingSeconds=0, message="Word voice is ready." if complete else "Completed words are saved. Resume to retry missing words.")
        save()
    except Exception as error:
        if owns_job:
            state.update(status="error", remainingSeconds=None, message=str(error)[:300] or "Word preparation stopped. Resume to retry.")
            save()
    finally:
        own.release(); worker.release()


def handle(message, root, send):
    envelope = {"type": "word-neural-prepare-result", "requestId": message.get("requestId")}
    try:
        kind = message.get("type")
        if kind == "word-neural-prepare":
            state = start(root, message)
        elif kind == "word-neural-prepare-status":
            state = status(root, message.get("jobId"))
        elif kind == "word-neural-prepare-pause":
            state = pause(root, message.get("jobId"))
        else:
            raise ValueError("Unknown word preparation request.")
        send({**envelope, "ok": True, "state": state})
    except Exception as error:
        code = error.code if isinstance(error, (JobError, neural.NeuralError)) else "invalid_word_prepare" if isinstance(error, ValueError) else "word_prepare_failed"
        send({**envelope, "ok": False, "code": code, "error": str(error)[:300] or "Word preparation failed."})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["_run"])
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--token", required=True)
    args = parser.parse_args()
    if re.fullmatch(r"[a-f0-9]{32}", args.token) is None:
        raise ValueError("Invalid worker token.")
    run(args.cache_root, _job_id(args.job_id), args.token)


if __name__ == "__main__":
    main()
