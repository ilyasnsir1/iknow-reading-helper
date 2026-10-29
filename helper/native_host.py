"""iKnow Reading Helper native-messaging host (stdio, no HTTP listener).

The browser is the protocol client. All model work stays in engine.py and its
durable cache; this process only validates requests, serializes jobs and reports
their real progress. Stdout must contain length-prefixed JSON messages only.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import struct
import sys
import threading
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))

import support_events

# Limit BLAS/OpenMP before their DLLs are loaded by any worker. The speech
# supervisor is a separate process with its own resource policy.
from process_resources import worker_threads
for _thread_variable in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[_thread_variable] = str(worker_threads())

HOST_VERSION = "1.22.0"
MAX_INPUT = 16 * 1024 * 1024
MAX_RESULT = 8 * 1024 * 1024
CACHE_ROOT = Path(os.environ.get("IKNOW_READER_CACHE", str(Path(os.environ.get("LOCALAPPDATA", Path.home())) / "iKnowLesehilfe"))).resolve()
JOBS_ROOT = CACHE_ROOT / "jobs"
write_lock = threading.Lock()
jobs_lock = threading.Lock()
jobs: dict[str, "Job"] = {}
stopping = threading.Event()


def read_exact(stream, size):
    chunks = bytearray()
    while len(chunks) < size:
        chunk = stream.read(size - len(chunks))
        if not chunk:
            if not chunks:
                return None
            raise ValueError("Incomplete message.")
        chunks.extend(chunk)
    return bytes(chunks)


def send(value):
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(payload) > 1024 * 1024:
        raise ValueError("Protocol message is too large.")
    with write_lock:
        try:
            sys.stdout.buffer.write(struct.pack("<I", len(payload)))
            sys.stdout.buffer.write(payload)
            sys.stdout.buffer.flush()
        except (BrokenPipeError, OSError):
            stopping.set()
            for job in list(jobs.values()):
                job.cancel.set()
            raise InterruptedError("Browser-Verbindung wurde geschlossen.")


def atomic_json(path, value):
    temporary = path.with_name(path.name + f".{os.getpid()}.{threading.get_ident()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    # A concurrent Windows reader may briefly hold the destination without
    # delete-sharing. Retry the atomic rename rather than lose a checkpoint.
    try:
        for attempt in range(20):
            try:
                os.replace(temporary, path)
                return
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(.01 * (attempt + 1))
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def course_id(value):
    if isinstance(value, bool) or not re.fullmatch(r"[1-9][0-9]{0,8}", str(value)):
        raise ValueError("Invalid course ID.")
    return str(value)


def feature_mask(features=None):
    if features is None:
        return {"german": True, "colors": True, "audio": True}
    if not isinstance(features, dict) or any(key not in {"german", "colors", "audio"} or type(value) is not bool for key, value in features.items()):
        raise ValueError("The selected modules are invalid.")
    return {key: features.get(key, False) for key in ("german", "colors", "audio")}


def source_signature(source, features=None):
    # Exclude changing popularity counters from the job identity. engine.py
    # performs the authoritative content/version check for cached results.
    def content(value):
        if isinstance(value, dict):
            return {key: content(item) for key, item in value.items() if key in {
                "id", "title", "goal_items", "item", "sentences", "cue", "response",
                "text", "transliterations", "Latn", "Hrkt", "Jpan", "sound",
                "items_count", "sentences_count", "language", "type"}}
        if isinstance(value, list):
            return [content(item) for item in value]
        return value
    encoded = json.dumps({"source": content(source), "features": feature_mask(features)}, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def word_reply(message, component):
    """Capture speech outcomes/timings without the requested word or audio."""
    journal = support_events.Recorder(CACHE_ROOT, component, requestKey=support_events.correlation(message.get("requestId")),
        courseId=message.get("courseId"), voice=message.get("voice"), playbackSpeed=message.get("speed"))
    began = time.monotonic()
    journal.record("word_requested", status="running")
    def reply(value):
        if isinstance(value, dict):
            journal.record("word_ready" if value.get("ok") else "word_failed",
                status="complete" if value.get("ok") else "error", code=value.get("code"), cached=value.get("cached"),
                durationMs=max(0, round((time.monotonic() - began) * 1000)))
        send(value)
    return reply


class FileLock:
    def __init__(self, path):
        self.path, self.file = path, None

    def acquire(self):
        if self.file is None:
            self.file = open(self.path, "a+b")
            if self.file.tell() == 0:
                self.file.write(b"0")
                self.file.flush()
        try:
            self.file.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except (OSError, BlockingIOError):
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
        except OSError:
            pass
        self.file.close()
        self.file = None


class Job:
    def __init__(self, identifier, source, request_id, force=False, features=None):
        self.identifier, self.source, self.request_id = identifier, source, request_id
        self.force = force
        self.features = feature_mask(features)
        self.signature = source_signature(source, self.features)
        self.token = uuid.uuid4().hex
        self.cancel = threading.Event()
        self.finished = threading.Event()
        self.cancel_watcher = None
        self.state_path = JOBS_ROOT / f"{identifier}.json"
        self.result_path = JOBS_ROOT / f"{identifier}.result.json"
        self.cancel_path = JOBS_ROOT / f"{identifier}.cancel"
        self.last = {"type": "progress", "courseId": identifier, "status": "running", "stage": "model", "completed": 0, "total": 0, "message": "Starting preparation …"}
        self.owns_lock = False
        self.engine_meta = {}
        self.started_at = int(time.time() * 1000)
        self.started_monotonic = time.monotonic()
        self.last_progress_at = self.started_at
        self.last_journal_at = 0
        self.last_journal_stage = None
        self.last_journal_completed = 0
        self.journal = support_events.Recorder(CACHE_ROOT, "preparation", courseId=identifier,
            jobKey=support_events.correlation(self.token), requestKey=support_events.correlation(request_id), features=self.features)
        self.thread = threading.Thread(target=self.run, name=f"course-{identifier}", daemon=True)

    def envelope(self, data):
        output = {**data, "courseId": self.identifier, "features": self.features}
        if self.request_id is not None:
            output["requestId"] = self.request_id
        return output

    def emit(self, data, persist=True):
        if stopping.is_set() or self.cancel.is_set() or (self.owns_lock and self.cancel_requested()):
            self.cancel.set()
            raise InterruptedError("Preparation paused.")
        if data.get("type") == "partial":
            self.result(data["pack"], interim=True)
            return
        if data.get("type") == "heartbeat":
            data = {**self.last, "message": data.get("message", self.last.get("message", ""))}
        for key in ("cached", "partial", "audioExcluded", "translationExcluded", "wordExcluded", "colorsExcluded"):
            if key in data and isinstance(data[key], (int, bool)):
                self.engine_meta[key] = data[key]
        stage = data.get("stage", data.get("phase", "model"))
        stage = {"translate": "language", "translation": "language", "groups": "language", "align": "audio", "ready": "done"}.get(stage, stage)
        if stage not in {"model", "language", "audio", "done"}:
            stage = "model"
        completed = data.get("completed", 0)
        total = data.get("total", 0)
        completed = completed if isinstance(completed, (int, float)) and not isinstance(completed, bool) and completed >= 0 else 0
        total = total if isinstance(total, (int, float)) and not isinstance(total, bool) and total >= completed else 0
        output = {"type": "progress", "status": "running", "stage": stage, "completed": completed, "total": total,
                  "message": str(data.get("message", ""))[:500]}
        now = int(time.time() * 1000)
        if stage != self.last.get("stage") or completed != self.last.get("completed"):
            self.last_progress_at = now
        self.last = self.envelope(output)
        if persist and self.owns_lock:
            atomic_json(self.state_path, {**self.last, **self.support_state(), "sourceDigest": self.signature, "jobToken": self.token, "updatedAt": time.time()})
        if stage != self.last_journal_stage or completed - self.last_journal_completed >= 5 or now - self.last_journal_at >= 10000:
            self.journal.record("phase_changed" if stage != self.last_journal_stage else "progress", stage=stage,
                status="running", completed=completed, total=total, lastProgressAt=self.last_progress_at,
                durationMs=max(0, round((time.monotonic() - self.started_monotonic) * 1000)))
            self.last_journal_at, self.last_journal_stage, self.last_journal_completed = now, stage, completed
        send(self.last)

    def support_state(self):
        return {"startedAt": self.started_at, "lastProgressAt": self.last_progress_at,
                "durationMs": max(0, round((time.monotonic() - self.started_monotonic) * 1000)),
                "jobKey": self.journal.context.get("jobKey"), "requestKey": self.journal.context.get("requestKey")}

    def cancel_requested(self):
        if not self.cancel_path.exists():
            return False
        signal = read_json(self.cancel_path)
        # Empty signals are accepted for compatibility with an older host.
        return not signal or (isinstance(signal, dict) and signal.get("jobToken") == self.token)

    def watch_cancellation(self):
        # A pause may arrive on another native connection. Checking the file
        # only in emit() misses the entire time spent inside model inference.
        # This watcher bridges the durable signal into the engine's Event.
        while not self.finished.wait(.1):
            if stopping.is_set() or self.cancel.is_set() or self.cancel_requested():
                self.cancel.set()
                return

    def result(self, pack, interim=False):
        encoded = json.dumps(pack, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        byte_count = len(encoded.encode("utf-8"))
        if byte_count > MAX_RESULT:
            raise ValueError("The generated course data is too large.")
        alignments = pack.get("alignments", {})
        audio = pack.get("audio", {})
        sentences = pack.get("course", {}).get("sentenceCount", len(alignments))
        translated = sum(bool(record.get("german", {}).get("text")) for record in alignments.values())
        colors = sum(record.get("colorsReady", True) is True and (not self.features["german"] or record.get("germanColorsReady", bool(record.get("german"))) is True) for record in alignments.values())
        summary = {"sentences": sentences, "translated": translated,
                   "translationExcluded": max(0, sentences - translated) if self.features["german"] else 0,
                   "wordExcluded": max(0, pack.get("course", {}).get("wordCount", 0) - len(pack.get("germanItems", {}))) if self.features["german"] else 0,
                   "audioAccepted": len(audio), "audioExcluded": max(0, sentences - len(audio)) if self.features["audio"] else 0,
                   "groupsExcluded": max(0, sentences - colors) if self.features["colors"] else 0}
        metadata = {**self.engine_meta, "interim": interim}
        self.journal.record("checkpoint_sent" if interim else "result_sent", stage=self.last.get("stage", "model"),
                            interim=interim, **summary)
        # Keep each native-message frame well below Chromium's 1 MiB limit.
        if byte_count < 850_000:
            send(self.envelope({"type": "result", "pack": pack, "summary": summary, **metadata}))
        else:
            transfer = uuid.uuid4().hex
            chunks = [encoded[index:index + 160_000] for index in range(0, len(encoded), 160_000)]
            send(self.envelope({"type": "result-start", "transferId": transfer, "bytes": byte_count, "totalChunks": len(chunks), "chunks": len(chunks), "summary": summary, **metadata}))
            for index, chunk in enumerate(chunks):
                send(self.envelope({"type": "result-chunk", "transferId": transfer, "index": index, "data": chunk}))
            send(self.envelope({"type": "result-end", "transferId": transfer, "summary": summary, **metadata}))

    def run(self):
        lock = FileLock(JOBS_ROOT / f"{self.identifier}.lock")
        worker_lock = FileLock(JOBS_ROOT / "worker.lock")
        try:
            self.journal.record("job_started", status="running", startedAt=self.started_at, workerThreads=worker_threads())
            self.emit({"stage": "model", "message": "Starting preparation …"}, persist=False)
            last_observed = None
            while not lock.acquire():
                if self.cancel.is_set() or stopping.is_set():
                    raise InterruptedError("Preparation paused.")
                state = read_json(self.state_path)
                if state and state.get("sourceDigest") == self.signature and state != last_observed:
                    last_observed = state
                    forwarded = {key: value for key, value in state.items() if key not in {"sourceDigest", "jobToken", "updatedAt", "requestId"}}
                    send(self.envelope(forwarded))
                time.sleep(.25)
            self.owns_lock = True
            self.cancel_path.unlink(missing_ok=True)
            self.cancel_watcher = threading.Thread(target=self.watch_cancellation, name=f"cancel-{self.identifier}", daemon=True)
            self.cancel_watcher.start()
            self.emit({"stage": "model", "message": "Preparing local processing …"})
            waiting = False
            while not worker_lock.acquire():
                if not waiting:
                    self.emit({"stage": "model", "message": "Another course is being prepared. Your course is next …"})
                    waiting = True
                if self.cancel.is_set() or stopping.is_set() or self.cancel_requested():
                    raise InterruptedError("Preparation paused.")
                time.sleep(.25)
            from engine import prepare
            pack = prepare(int(self.identifier), self.source, CACHE_ROOT, self.emit, self.cancel, force=self.force, features=self.features)
            if self.cancel.is_set() or stopping.is_set() or self.cancel_requested():
                raise InterruptedError("Preparation paused.")
            atomic_json(self.result_path, pack)
            self.result(pack)
            total = pack.get("course", {}).get("sentenceCount", 0)
            total = total if type(total) is int and total >= 0 else 0
            self.last = self.envelope({"type": "progress", "status": "complete", "stage": "done", "completed": total, "total": total, "message": "Preparation saved.", **self.engine_meta})
            self.journal.record("job_completed", status="complete", stage="done", completed=total, total=total,
                                **self.support_state(), **self.engine_meta)
            atomic_json(self.state_path, {**self.last, **self.support_state(), "sourceDigest": self.signature, "jobToken": self.token, "updatedAt": time.time()})
            send(self.last)
        except InterruptedError as error:
            checkpoint = getattr(error, "pack", None)
            if checkpoint and not stopping.is_set():
                # Pausing must retain the last few completed additions in the
                # browser too, rather than waiting for the next resume.
                try:
                    self.result(checkpoint, interim=True)
                except (InterruptedError, OSError):
                    pass  # Browser closed; the per-record disk cache remains.
            reason = getattr(error, "code", None)
            message = str(error) if reason == "network_unavailable" else "Preparation paused. Completed results are kept."
            self.last = self.envelope({"type": "progress", "status": "cancelled", "stage": self.last.get("stage", "model"), "completed": self.last.get("completed", 0), "total": self.last.get("total", 0), "message": message,
                                       **({"code": reason} if reason == "network_unavailable" else {})})
            self.journal.record("job_cancelled", status="cancelled", stage=self.last.get("stage", "model"),
                completed=self.last.get("completed", 0), total=self.last.get("total", 0),
                reason=reason if reason == "network_unavailable" else "requested", **self.support_state())
            if self.owns_lock:
                atomic_json(self.state_path, {**self.last, **self.support_state(), "sourceDigest": self.signature, "jobToken": self.token, "updatedAt": time.time()})
            if not stopping.is_set():
                send(self.last)
        except Exception as error:
            checkpoint = getattr(error, "pack", None)
            if checkpoint and not stopping.is_set():
                try:
                    self.result(checkpoint, interim=True)
                except (InterruptedError, OSError, ValueError):
                    pass  # A disconnected browser can restore disk checkpoints.
            message = str(error)[:500] or "Local preparation failed."
            code = getattr(error, "code", "preparation_failed")
            if not isinstance(code, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,79}", code):
                code = "preparation_failed"
            self.last = self.envelope({"type": "error", "status": "error", "code": code, "message": message,
                                       "stage": self.last.get("stage", "model"), "completed": self.last.get("completed", 0), "total": self.last.get("total", 0)})
            failure = support_events.exception_info(error)
            self.journal.record("job_failed", status="error", code=code, stage=self.last.get("stage", "model"),
                completed=self.last.get("completed", 0), total=self.last.get("total", 0), failure=failure, **self.support_state())
            if self.owns_lock:
                atomic_json(self.state_path, {**self.last, **self.support_state(), "failure": failure,
                    "sourceDigest": self.signature, "jobToken": self.token, "updatedAt": time.time()})
            if not stopping.is_set():
                send(self.last)
        finally:
            self.finished.set()
            if self.cancel_watcher is not None:
                self.cancel_watcher.join(timeout=.25)
            worker_lock.release()
            lock.release()


def handle(message):
    if not isinstance(message, dict):
        raise ValueError("Invalid message.")
    request_id = message.get("requestId")
    if request_id is not None and (not isinstance(request_id, (str, int)) or isinstance(request_id, bool) or len(str(request_id)) > 100):
        raise ValueError("Invalid request ID.")
    kind = message.get("type")
    if kind == "ping":
        send({"type": "pong", "version": HOST_VERSION, "requestId": request_id})
        return
    if kind == "changelog:author":
        import changelog_authoring
        changelog_authoring.handle(message, Path(__file__).resolve().parent.parent, send)
        return
    if kind == "diagnostics":
        import diagnostics
        send({"type": "diagnostics-result", "requestId": request_id, "ok": True,
              "report": diagnostics.collect(CACHE_ROOT, HOST_VERSION, active_checks=message.get("extended") is True)})
        return
    if kind in {"components:status", "components:start", "components:pause", "components:resume"}:
        import component_manager
        def component_busy():
            import updater
            return updater.installing(CACHE_ROOT) or any(job.thread.is_alive() for job in list(jobs.values())) or any(
                getattr(getattr(sys.modules.get(name), "_requests", None), "unfinished_tasks", 0)
                for name in ("neural_speech", "word_speech"))
        component_manager.handle(message, CACHE_ROOT, send, busy=component_busy)
        return
    if kind in {"update:check", "update:status", "update:install"}:
        import updater
        def update_busy():
            import component_manager
            if component_manager.is_active(CACHE_ROOT):
                return True
            if any(job.thread.is_alive() for job in list(jobs.values())):
                return True
            # Queue.unfinished_tasks includes the word currently synthesized,
            # even after the request has been removed from its waiting queue.
            for name in ("neural_speech", "word_speech"):
                module = sys.modules.get(name)
                requests = getattr(module, "_requests", None)
                if requests is not None and requests.unfinished_tasks:
                    return True
            return False
        updater.handle(message, CACHE_ROOT, send, HOST_VERSION, busy=update_busy)
        return
    if kind in {"prepare", "word-neural", "word-speech", "word-neural-prepare"}:
        import component_manager
        if component_manager.is_active(CACHE_ROOT):
            send({"type": {"word-neural": "word-neural-result", "word-speech": "word-speech-result", "word-neural-prepare": "word-neural-prepare-result"}.get(kind, "error"),
                  "requestId": request_id, "courseId": message.get("courseId"), "ok": False,
                  "code": "component_installing", "message": "Wait for the model download or installation to finish.",
                  "error": "Wait for the model download or installation to finish."})
            return
        import updater
        if updater.installing(CACHE_ROOT):
            envelope = {"type": {"word-neural": "word-neural-result", "word-speech": "word-speech-result",
                                  "word-neural-prepare": "word-neural-prepare-result"}.get(kind, "error"),
                        "requestId": request_id, "ok": False, "code": "update_in_progress",
                        "message": "An application update is being installed. Please wait.",
                        "error": "An application update is being installed. Please wait."}
            if message.get("courseId") is not None:
                envelope["courseId"] = str(message["courseId"])
            send(envelope)
            return
    if kind in {"word-neural-prepare", "word-neural-prepare-status", "word-neural-prepare-pause"}:
        import word_voice_jobs
        word_voice_jobs.handle(message, CACHE_ROOT, send)
        return
    if kind in {"word-neural", "word-neural-status"}:
        import neural_speech
        if kind == "word-neural-status":
            send({"type": "word-neural-status-result", "requestId": request_id, **neural_speech.status(CACHE_ROOT)})
        else:
            neural_speech.enqueue(message, CACHE_ROOT, word_reply(message, "word_audio"), stopping)
        return
    if kind in {"word-speech", "word-speech-status"}:
        import word_speech
        if kind == "word-speech-status":
            send({"type": "word-speech-status-result", "requestId": request_id, "ok": True,
                  "ready": word_speech.installed(), "voice": word_speech.VOICE, "voiceVersion": word_speech.VERSION})
        else:
            word_speech.enqueue(message, CACHE_ROOT, word_reply(message, "word_audio"), stopping)
        return
    identifier = course_id(message.get("courseId"))
    if kind not in {"prepare", "status", "cancel"}:
        raise ValueError("Unknown request.")
    if kind in {"prepare", "cancel"}:
        JOBS_ROOT.mkdir(parents=True, exist_ok=True)
    if kind == "prepare":
        # Load numerical DLLs on the stdin/main thread before starting a course
        # worker. Word-only connections need neither ASR nor its startup cost.
        features = feature_mask(message.get("features"))
        if features["audio"]:
            try:
                import numpy, av, ctranslate2, faster_whisper
            except ImportError:
                pass
        source = message.get("source")
        if source is not None and (not isinstance(source, dict) or str(source.get("id")) != identifier or not isinstance(source.get("goal_items"), list) or len(source["goal_items"]) > 10000):
            raise ValueError("Course data does not match the course ID.")
        with jobs_lock:
            previous = jobs.get(identifier)
            if previous and previous.thread.is_alive():
                if previous.signature == source_signature(source, features) and not previous.cancel.is_set():
                    previous.request_id = request_id
                    previous.last["requestId"] = request_id
                    send(previous.last)
                    return
                previous.cancel.set()
            job = Job(identifier, source, request_id, force=message.get("force") is True, features=features)
            jobs[identifier] = job
            job.thread.start()
        return
    job = jobs.get(identifier)
    if kind == "cancel":
        if job and request_id is not None and job.request_id != request_id:
            return
        if job and job.thread.is_alive():
            job.cancel.set()
        saved = read_json(JOBS_ROOT / f"{identifier}.json")
        if not job and request_id is not None and saved and saved.get("requestId") != request_id:
            return
        token = job.token if job else saved.get("jobToken") if saved else None
        # A late cancel for an old request must not stop an immediate resume.
        # The owner checks the token before propagating this into its Event.
        atomic_json(JOBS_ROOT / f"{identifier}.cancel", {"jobToken": token, "requestId": request_id})
        if job and job.thread.is_alive():
            # The worker flushes completed additions and reaps its model before
            # acknowledging pause. An early ACK let the browser close this port
            # while the last snapshot was still being saved.
            return
        send({"type": "progress", "courseId": identifier, "requestId": request_id, "status": "cancelled", "stage": job.last.get("stage", "model") if job else "model", "completed": 0, "total": 0, "message": "Preparation paused. Completed results are kept."})
        return
    if job and job.thread.is_alive():
        send(job.last)
        return
    saved = read_json(JOBS_ROOT / f"{identifier}.json")
    if saved:
        state = {key: value for key, value in saved.items() if key not in {"sourceDigest", "jobToken", "updatedAt", "requestId"}}
        if state.get("status") == "running":
            probe = FileLock(JOBS_ROOT / f"{identifier}.lock")
            if probe.acquire():
                state.update(status="cancelled", message="Saved preparation can be resumed.")
            probe.release()
        send({**state, "requestId": request_id})
    else:
        send({"type": "progress", "courseId": identifier, "requestId": request_id, "status": "idle", "stage": "model", "completed": 0, "total": 0, "message": "This course has not been prepared yet."})


_dependencies_ready = False


def warm_dependencies():
    global _dependencies_ready
    if _dependencies_ready:
        return
    # Initialize Windows numerical DLLs on the main thread before its blocking
    # stdin reader starts. Loading NumPy/OpenBLAS for the first time from a job
    # thread while the CRT is blocked on stdin can deadlock DLL initialization.
    try:
        import numpy
    except ImportError:
        pass  # Cached data still works; preparation reports missing packages.
    try:
        import word_speech
        word_speech.warm_import()
    except ImportError:
        pass
    try:
        import neural_speech
        neural_speech.warm_import()
    except ImportError:
        pass
    _dependencies_ready = True


def main():
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    try:
        while not stopping.is_set():
            header = read_exact(sys.stdin.buffer, 4)
            if header is None:
                break
            size = struct.unpack("<I", header)[0]
            if not 0 < size <= MAX_INPUT:
                support_events.append(CACHE_ROOT, "native", "protocol_error", code="invalid_size", status="error")
                send({"type": "error", "code": "invalid_size", "message": "Message is too large or empty."})
                break
            payload = read_exact(sys.stdin.buffer, size)
            if payload is None:
                break
            try:
                message = json.loads(payload.decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Invalid number.")))
                # Update metadata/status and version pings do not need numerical
                # DLLs or voice imports. Load dependencies on the stdin thread
                # before other work to preserve the existing Windows CRT rule.
                if isinstance(message, dict) and message.get("type") not in {"update:check", "update:status", "update:install", "components:status", "components:start", "components:pause", "components:resume", "ping", "diagnostics", "changelog:author"}:
                    warm_dependencies()
                handle(message)
            except (ValueError, TypeError, UnicodeError) as error:
                support_events.Recorder(CACHE_ROOT, "native").error("protocol_error", error, code="invalid_request", status="error")
                send({"type": "error", "code": "invalid_request", "message": str(error)[:200]})
    except (BrokenPipeError, OSError, InterruptedError, ValueError) as error:
        support_events.Recorder(CACHE_ROOT, "native").error("connection_closed", error, status="interrupted")
    finally:
        stopping.set()
        for job in list(jobs.values()):
            job.cancel.set()
        # A bounded wait gives the pipeline time to save its current checkpoint.
        deadline = time.monotonic() + 2
        for job in list(jobs.values()):
            job.thread.join(max(0, deadline - time.monotonic()))


if __name__ == "__main__":
    main()
