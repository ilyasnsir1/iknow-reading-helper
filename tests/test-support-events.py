"""Persistent helper diagnostics: bounded, private, restart-safe and nonfatal."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

HELPER = Path(__file__).resolve().parents[1] / "helper"
sys.path.insert(0, str(HELPER))
import engine
import native_host as host
import support_events as events


class SupportEventTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="iknow-support-events-")
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_history_survives_new_process_and_reading_never_creates_files(self):
        missing = self.root / "absent"
        self.assertEqual(events.read_recent(missing)["status"], "missing")
        self.assertFalse(missing.exists())
        recorder = events.Recorder(self.root, "preparation", courseId="594768", requestKey=events.correlation("private request"))
        self.assertTrue(recorder.record("job_started", completed=0, total=200))
        program = "import sys,json;sys.path.insert(0,sys.argv[1]);import support_events;print(json.dumps(support_events.read_recent(sys.argv[2])))"
        child = subprocess.run([sys.executable, "-B", "-c", program, str(HELPER), str(self.root)], capture_output=True, check=True, timeout=15)
        report = json.loads(child.stdout)
        self.assertEqual(report["events"][0]["courseId"], "594768")
        self.assertEqual(report["events"][0]["event"], "job_started")
        self.assertNotIn("private request", child.stdout.decode())
        before = {p: (p.stat().st_mtime_ns, p.read_bytes()) for p in self.root.rglob("*") if p.is_file()}
        events.read_recent(self.root)
        self.assertEqual(before, {p: (p.stat().st_mtime_ns, p.read_bytes()) for p in self.root.rglob("*") if p.is_file()})

    def test_rotation_and_export_limits_are_enforced(self):
        with patch.object(events, "MAX_FILE_BYTES", 1024):
            for index in range(200):
                self.assertTrue(events.append(self.root, "model", "inference_response", completed=index, durationMs=15))
            report = events.read_recent(self.root, limit=3)
            for path in (self.root / "support").glob("*.ndjson"):
                self.assertLessEqual(path.stat().st_size, 1024)
            self.assertEqual(len(report["events"]), 3)
            self.assertEqual(report["events"][-1]["completed"], 199)
            self.assertTrue(report["truncated"])
            self.assertEqual(len(list((self.root / "support").glob("*.ndjson"))), 2)

    def test_only_explicit_fields_and_exception_facts_survive(self):
        secret = "private person C:/Users/private/request?token=secret 日本語"
        try:
            try:
                raise OSError(5, secret)
            except OSError as cause:
                raise RuntimeError(secret) from cause
        except RuntimeError as error:
            failure = events.exception_info(error)
        events.append(self.root, "preparation", "job_failed", courseId="594768", code="preparation_failed",
                      requestId=secret, path=secret, prompt=secret, message=secret,
                      stage="https://private/secret", failure=failure,
                      features={"german": True, "secret": secret})
        raw = (self.root / "support/events.ndjson").read_text()
        self.assertNotIn(secret, raw)
        self.assertNotIn("private", raw)
        report = events.read_recent(self.root)
        item = report["events"][0]
        self.assertEqual(item["failure"]["type"], "builtins.RuntimeError")
        self.assertEqual(item["failure"]["chain"][1]["errno"], 5)
        self.assertNotIn("stage", item)
        self.assertEqual(item["features"], {"german":True,"colors":False,"audio":False})
        # Even an edited local event file must be revalidated before export.
        with (self.root / "support/events.ndjson").open("a") as out:
            out.write(json.dumps({"component":"model","event":"edited","path":secret,"failure":{"type":"not/a/type", "message":secret, "frames":[{"module":"C:/Users/private", "function":"bad", "line":1}]}}) + "\n")
        serialized = json.dumps(events.read_recent(self.root))
        self.assertNotIn("private", serialized)
        self.assertNotIn(secret, serialized)

    def test_independent_hosts_and_threads_produce_whole_records(self):
        program = """import sys
sys.path.insert(0,sys.argv[1])
import support_events
for n in range(40):
 if not support_events.append(sys.argv[2],'preparation','progress',requestKey=support_events.correlation(sys.argv[3]),completed=n,total=40):raise RuntimeError('append failed')
"""
        children = [subprocess.Popen([sys.executable, "-B", "-c", program, str(HELPER), str(self.root), str(index)], stdout=subprocess.PIPE, stderr=subprocess.PIPE) for index in range(3)]
        errors = []
        def writer():
            for index in range(40):
                if not events.append(self.root, "preparation", "progress", completed=index, total=40):
                    errors.append(index)
        thread = threading.Thread(target=writer)
        thread.start()
        for child in children:
            _, err = child.communicate(timeout=20)
            self.assertEqual(child.returncode, 0, err.decode())
        thread.join(5)
        self.assertFalse(errors)
        lines = (self.root / "support/events.ndjson").read_bytes().splitlines()
        self.assertEqual(len(lines), 160)
        self.assertTrue(all(json.loads(line)["event"] == "progress" for line in lines))

    def test_unwritable_or_invalid_journal_never_fails_model_operation(self):
        (self.root / "support").write_text("A conflicting file must not break preparation")
        recorder = events.Recorder(self.root, "model")
        self.assertFalse(recorder.record("model_ready"))
        with patch.object(engine.LocalModel, "request", return_value={"choices":[{"message":{"content":'{"ok":true}'}}]}):
            model = engine.LocalModel(self.root, {}, lambda _: None, threading.Event())
            try:
                self.assertEqual(model.generate("PRIVATE PROMPT", "PRIVATE REQUEST", {}), {"ok":True})
            finally:
                model.__exit__()

    def job(self, prepare):
        jobs = self.root / "jobs"
        jobs.mkdir()
        sent = []
        with patch.object(host, "CACHE_ROOT", self.root), patch.object(host, "JOBS_ROOT", jobs), patch.object(host, "send", sent.append), patch.object(engine, "prepare", side_effect=prepare):
            job = host.Job("594768", {"id":594768}, "request secret", features={"german":True})
            job.run()
        state = json.loads((jobs / "594768.json").read_bytes())
        return job, sent, state

    def test_first_course_failure_keeps_context_and_trace_after_later_job(self):
        def prepare(_id, _source, _cache, emit, _cancel, **_):
            emit({"stage":"language", "completed":41, "total":200, "message":"PRIVATE sentence"})
            try:
                raise TimeoutError("PRIVATE request")
            except TimeoutError as error:
                raise engine.ModelServiceError("model_request_timeout", "The local model took too long") from error
        job, sent, state = self.job(prepare)
        self.assertEqual(state["completed"], 41)
        self.assertEqual(state["total"], 200)
        self.assertEqual(state["failure"]["chain"][1]["type"], "builtins.TimeoutError")
        self.assertEqual(state["requestKey"], events.correlation("request secret"))
        self.assertGreater(state["startedAt"], 10**12)
        report = events.read_recent(self.root)
        self.assertTrue(any(event["event"] == "job_failed" and event["code"] == "model_request_timeout" for event in report["events"]))
        self.assertNotIn("PRIVATE", json.dumps(report))
        self.assertNotIn("request secret", json.dumps(report))
        events.Recorder(self.root, "preparation", courseId="594770").record("job_completed", completed=200, total=200)
        self.assertEqual(events.read_recent(self.root)["events"][-2]["event"], "job_failed")

    def test_cancellation_preserves_progress_and_matching_model_correlation(self):
        def prepare(_id, _source, cache, emit, _cancel, **_):
            emit({"stage":"audio", "completed":79, "total":187, "message":"fixture"})
            model = engine.LocalModel(cache, {}, emit, threading.Event())
            try:
                model.journal.record("model_ready", status="ready")
            finally:
                model.__exit__()
            raise InterruptedError("pause")
        job, _, state = self.job(prepare)
        self.assertEqual((state["status"],state["stage"],state["completed"],state["total"]), ("cancelled","audio",79,187))
        report = events.read_recent(self.root)
        ready = next(event for event in report["events"] if event["event"] == "model_ready")
        terminal = next(event for event in report["events"] if event["event"] == "job_cancelled")
        self.assertEqual(ready["jobKey"], terminal["jobKey"])
        self.assertEqual(terminal["completed"],79)
        self.assertEqual(terminal["courseId"],"594768")

    def test_word_callback_logs_selected_voice_outcome_and_time_without_word_or_audio(self):
        sent = []
        with patch.object(host, "CACHE_ROOT", self.root), patch.object(host, "send", sent.append):
            reply = host.word_reply({"requestId":"PRIVATE request", "voice":"female", "speed":1,
                                     "text":"PRIVATE word", "kana":"日本語"}, "word_audio")
            payload = {"ok":False, "code":"voice_not_ready", "error":"PRIVATE path", "audio":"PRIVATE AUDIO"}
            reply(payload)
        report = events.read_recent(self.root)
        self.assertEqual(report["events"][-1]["event"], "word_failed")
        self.assertEqual(report["events"][-1]["voice"], "female")
        self.assertEqual(report["events"][-1]["playbackSpeed"], 1)
        self.assertEqual(report["events"][-1]["code"], "voice_not_ready")
        self.assertNotIn("PRIVATE", json.dumps(report))
        self.assertNotIn("日本語", json.dumps(report))
        self.assertEqual(sent,[payload])


if __name__ == "__main__":
    unittest.main(verbosity=2)
