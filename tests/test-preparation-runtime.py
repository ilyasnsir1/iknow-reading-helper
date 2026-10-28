"""Real local transport/cancellation plus isolated course-state fixtures.

Runs against this checkout only; no user installation, cache or models touched.
"""
import contextlib
import http.server
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
from unittest.mock import patch

HELPER = Path(__file__).resolve().parents[1] / "helper"
sys.path.insert(0, str(HELPER))
import engine
import native_host as host


RESPONSE = {"choices": [{"message": {"content": '{"ok":true}'}, "finish_reason": "stop"}]}


class PreparationRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="iknow-preparation-runtime-")
        self.root = Path(self.temp.name)
        self.models = []

    def tearDown(self):
        for model in self.models:
            model.__exit__()
        self.temp.cleanup()

    def model(self, emit=lambda _: None, cancel=None):
        model = engine.LocalModel(self.root, {}, emit, cancel or threading.Event())
        self.models.append(model)
        return model

    @contextlib.contextmanager
    def server(self, payload, requests):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                raw = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *_):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            server.server_close()
            worker.join(2)

    def test_loopback_never_uses_windows_or_environment_proxy(self):
        direct, proxied = [], []
        with self.server({"local": True}, direct) as local, self.server({"proxy": True}, proxied) as proxy:
            with patch("urllib.request.getproxies", return_value={"http": proxy}), patch("urllib.request.proxy_bypass", return_value=False):
                model = self.model()
                model.base = local
                self.assertEqual(model.request("/health", None, timeout=2), {"local": True})
        self.assertEqual(direct, ["/health"])
        self.assertEqual(proxied, [])

    def test_inference_timeout_is_bounded_and_separate_from_health_probe(self):
        model = self.model()
        with patch.object(model, "request", return_value=RESPONSE) as request:
            self.assertEqual(model.generate("fixture", "fixture", {}), {"ok": True})
        self.assertEqual(request.call_args.kwargs["timeout"], 900)
        self.assertEqual(request.call_args.args[0], "/v1/chat/completions")

    def test_timeout_and_disconnect_have_actionable_distinct_codes(self):
        model = self.model()
        for failure, code in ((TimeoutError("timed out"), "model_request_timeout"),
                              (urllib.error.URLError(TimeoutError("timed out")), "model_request_timeout"),
                              (ConnectionResetError("fixture reset"), "model_connection_failed")):
            with self.subTest(code=code), patch.object(model, "request", side_effect=failure):
                with self.assertRaises(engine.ModelServiceError) as caught:
                    model.generate("fixture", "fixture", {})
                self.assertEqual(caught.exception.code, code)
                self.assertIn("Completed additions are kept", str(caught.exception))

    def test_inference_emits_liveness_without_fake_counts(self):
        events = []
        model = self.model(events.append)
        def slow_response(*_, **__):
            time.sleep(.4)
            return RESPONSE
        with patch.object(model, "request", side_effect=slow_response), patch.object(engine, "MODEL_HEARTBEAT_INTERVAL", .01):
            self.assertEqual(model.generate("fixture", "fixture", {}), {"ok": True})
        self.assertTrue(events)
        self.assertTrue(all(e["type"] == "heartbeat" and "completed" not in e for e in events))

    def test_pause_during_actual_blocking_http_response_reaps_model_promptly(self):
        # The child writes a partial response and then blocks. Cancellation must
        # close/reap the actual child instead of waiting for the 15-minute read.
        program = r'''
import http.server,time
class Handler(http.server.BaseHTTPRequestHandler):
 def do_POST(self):
  self.send_response(200);self.send_header('Content-Length','1000');self.end_headers()
  self.wfile.write(b'{');self.wfile.flush();print('READING',flush=True);time.sleep(60)
 def log_message(self,*_):pass
server=http.server.HTTPServer(('127.0.0.1',0),Handler)
print(server.server_port,flush=True)
server.serve_forever()
'''
        cancel = threading.Event()
        model = self.model(cancel=cancel)
        process = subprocess.Popen([sys.executable, "-u", "-c", program], stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        model.process = process
        model.base = f"http://127.0.0.1:{int(process.stdout.readline())}"
        observed = threading.Event()
        def pause_after_read_started():
            if process.stdout.readline().strip() == "READING":
                observed.set()
                cancel.set()
        watcher = threading.Thread(target=pause_after_read_started, daemon=True)
        watcher.start()
        started = time.monotonic()
        try:
            with self.assertRaises(InterruptedError):
                model.generate("fixture", "fixture", {})
            self.assertTrue(observed.is_set())
            self.assertLess(time.monotonic() - started, 3)
            self.assertIsNotNone(process.poll())
        finally:
            model.close_process()
            watcher.join(2)
            process.stdout.close()

    def run_job(self, prepare):
        jobs = self.root / "jobs"
        jobs.mkdir(exist_ok=True)
        events = []
        with patch.object(host, "CACHE_ROOT", self.root), patch.object(host, "JOBS_ROOT", jobs), patch.object(host, "send", events.append), patch.object(engine, "prepare", side_effect=prepare):
            job = host.Job("594768", {"id": 594768}, "fixture")
            job.run()
        return events, json.loads((jobs / "594768.json").read_text())

    def test_failed_job_keeps_real_stage_checkpoint_and_error_code(self):
        def fail(_id, _source, _cache, emit, _cancel, **_):
            emit({"stage": "language", "completed": 41, "total": 200, "message": "fixture"})
            emit({"type": "heartbeat", "message": "still processing"})
            raise engine.ModelServiceError("model_request_timeout", "Completed additions are kept.")
        events, state = self.run_job(fail)
        self.assertEqual(state["status"], "error")
        self.assertEqual((state["stage"], state["completed"], state["total"]), ("language", 41, 200))
        self.assertEqual(state["code"], "model_request_timeout")
        self.assertTrue(any(e.get("message") == "still processing" and e["completed"] == 41 and e["total"] == 200 for e in events))
        self.assertFalse(any(e.get("status") == "complete" for e in events))

    def test_success_persists_real_sentence_total_instead_of_one_of_one(self):
        def complete(_id, _source, _cache, emit, _cancel, **_):
            emit({"stage": "done", "completed": 187, "total": 187, "message": "fixture"})
            return {"course": {"id": 594768, "sentenceCount": 187, "wordCount": 100},
                    "alignments": {}, "audio": {}, "germanItems": {}}
        _, state = self.run_job(complete)
        self.assertEqual((state["status"], state["completed"], state["total"]), ("complete", 187, 187))

    def test_model_failure_flushes_latest_valid_checkpoint_and_resume_skips_it(self):
        def entry(identifier, word, english, ja, en, kana, roman, jpan):
            return {"item": {"id": identifier, "cue": {"language": "ja", "text": word}, "response": {"text": english}},
                    "sentences": [{"cue": {"id": identifier + 10, "text": ja, "transliterations": {"Hrkt": kana, "Latn": roman, "Jpan": jpan}},
                                   "response": {"text": en}}]}
        source = {"id": 594768, "title": "Explicit runtime recovery fixture", "goal_items": [
            entry(1, "水", "water", "水を飲む。", "I drink water.", "みず を のむ 。", "mizu wo nomu .", "水 を 飲む 。"),
            entry(2, "本", "book", "本を読む。", "I read a book.", "ほん を よむ 。", "hon wo yomu .", "本 を 読む 。")]}
        class FixtureModel:
            fail = True
            calls = []
            def __init__(self, *_): pass
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def generate(self, _system, prompt, _schema, *_args, **_kwargs):
                ja = json.loads(prompt)["japanischerSatz"]
                self.calls.append(ja)
                if self.fail and ja == "本を読む。":
                    raise engine.ModelServiceError("model_request_timeout", "Completed additions are kept.")
                return {"german": "Ich trinke Wasser." if ja == "水を飲む。" else "Ich lese ein Buch.",
                        "wordGerman": "Wasser" if ja == "水を飲む。" else "Buch"}
        features = {"german": True, "colors": False, "audio": False}
        with patch.object(engine, "LocalModel", FixtureModel):
            with self.assertRaises(engine.ModelServiceError) as caught:
                engine.prepare(594768, source, self.root, lambda _: None, threading.Event(), features=features)
            self.assertEqual(set(caught.exception.pack["alignments"]), {"11"})
            completed = next((self.root / "records").glob("11-*.json"))
            saved_bytes = completed.read_bytes()
            self.assertFalse((self.root / "courses/594768.json").exists())
            FixtureModel.fail = False
            FixtureModel.calls.clear()
            pack = engine.prepare(594768, source, self.root, lambda _: None, threading.Event(), features=features)
            self.assertEqual(FixtureModel.calls, ["本を読む。"])
            self.assertEqual(set(pack["alignments"]), {"11", "12"})
            self.assertEqual(completed.read_bytes(), saved_bytes)

    def test_first_inference_and_words_only_work_restore_language_phase_after_loading(self):
        source = {"id": 594768, "title": "Explicit phase fixture", "goal_items": [
            {"item": {"id": 1, "cue": {"language": "ja", "text": "水"}, "response": {"text": "water"}},
             "sentences": [{"cue": {"id": 11, "text": "水を飲む。", "transliterations": {
                 "Hrkt": "みず を のむ 。", "Latn": "mizu wo nomu .", "Jpan": "水 を 飲む 。"}},
                 "response": {"text": "I drink water."}}]}]}
        features = {"german": True, "colors": False, "audio": False}
        events = []
        owner = self
        class FixtureModel:
            expected_done = 0
            def __init__(self, _root, _config, emit, _cancel): self.emit = emit
            def __enter__(self):
                self.emit({"stage": "model", "completed": 0, "total": 0, "message": "Loading fixture"})
                return self
            def __exit__(self, *_): pass
            def generate(self, _system, _prompt, schema, *_args, **_kwargs):
                owner.assertEqual((events[-1]["stage"], events[-1]["completed"], events[-1]["total"]),
                                  ("language", self.expected_done, 1))
                if schema is engine.WORD_SCHEMA:
                    return {"wordGerman": "Wasser"}
                raise engine.ModelServiceError("model_request_timeout", "Fixture timeout during first request")
        with patch.object(engine, "LocalModel", FixtureModel):
            with self.assertRaises(engine.ModelServiceError):
                engine.prepare(594768, source, self.root, events.append, threading.Event(), features=features)
            course, digest = engine.course_source(594768, source)
            sentence = course["items"][0]["sentences"][0]
            # A valid saved sentence lacks its independent vocabulary meaning.
            pack = {"format": "iknow-reader-course", "schemaVersion": 1,
                    "course": {"id": 594768, "title": course["title"], "wordCount": 1, "sentenceCount": 1},
                    "alignments": {"11": {"signature": sentence["signature"], "groups": [],
                                          "german": {"text": "Ich trinke Wasser.", "groups": []}}},
                    "audio": {}, "germanItems": {}}
            engine.atomic_json(self.root / "courses/594768.json", {"version": engine.VERSION, "sourceHash": digest, "pack": pack})
            FixtureModel.expected_done = 1
            events.clear()
            result = engine.prepare(594768, source, self.root, events.append, threading.Event(), features=features)
            self.assertEqual(result["germanItems"]["1"]["text"], "Wasser")


if __name__ == "__main__":
    unittest.main(verbosity=2)
