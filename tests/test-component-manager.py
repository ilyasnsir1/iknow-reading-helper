"""Small isolated downloads and transactions; never use installed model storage."""
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import zipfile

HELPER = Path(__file__).resolve().parents[1] / "helper"
sys.path.insert(0, str(HELPER))
import component_manager as manager
import updater


class Response(io.BytesIO):
    status = 200
    def __init__(self, payload, *, status=200, headers=None):
        super().__init__(payload)
        self.status = status
        self.headers = {"Content-Length": str(len(payload)), **(headers or {})}
    def geturl(self):
        return "https://models.example.test/model"


class Components(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="iknow-components-test-")
        self.root = Path(self.temp.name) / "cache"
        self.root.mkdir()
        self.environment = patch.dict(os.environ, {"APPDATA": str(Path(self.temp.name) / "appdata"), "PYTHONDONTWRITEBYTECODE": "1"})
        self.environment.start()
        self.payload = b"fixture model version two" * 2000
        self.artifact = {"name": "Fixture", "url": "https://models.example.test/model", "target": "models/fixture.bin", "root": "cache", "sha256": hashlib.sha256(self.payload).hexdigest(), "size": len(self.payload), "maximum": len(self.payload), "archive": None}
        self.item = {"id": "fixture", "title": "Fixture component", "description": "No real model", "version": "2", "downloadBytes": len(self.payload), "sizeIsEstimate": False, "requirements": None, "artifacts": [self.artifact]}
        self.catalog = patch.object(manager, "COMPONENTS", {"fixture": self.item})
        self.catalog.start()
    def tearDown(self):
        self.catalog.stop(); self.environment.stop(); self.temp.cleanup()
    def target(self):
        return self.root / self.artifact["target"]
    def opener(self, request, **kwargs):
        return Response(self.payload)

    def test_fresh_status_is_cheap_and_cannot_download_or_execute(self):
        with patch.object(manager, "download", side_effect=AssertionError("download on status")), patch.object(manager, "_command", side_effect=AssertionError("process on status")):
            state = manager.snapshot(self.root)
        self.assertFalse(state["active"])
        self.assertEqual(state["components"][0]["status"], "missing")
        self.assertFalse((self.root / "components").exists())

    def test_pinned_download_and_existing_reuse(self):
        file = manager.download(self.root, self.artifact, opener=self.opener)
        self.assertEqual(file.read_bytes(), self.payload)
        file = manager.download(self.root, self.artifact, opener=lambda *a, **k: self.fail("Redownloaded verified data"))
        self.assertEqual(file.read_bytes(), self.payload)
        self.assertFalse(self.target().exists())

    def test_partial_range_resumes_and_reports_file_progress(self):
        directory = self.root / "components/downloads"; directory.mkdir(parents=True)
        part = directory / (self.artifact["sha256"] + ".part")
        offset = 1234; part.write_bytes(self.payload[:offset])
        def opener(request, **kwargs):
            self.assertEqual(request.get_header("Range"), f"bytes={offset}-")
            return Response(self.payload[offset:], status=206, headers={"Content-Range": f"bytes {offset}-{len(self.payload)-1}/{len(self.payload)}"})
        file = manager.download(self.root, self.artifact, opener=opener)
        self.assertEqual(file.read_bytes(), self.payload)
        self.assertFalse(part.exists())

    def test_bad_range_bad_hash_and_bounded_response_are_rejected(self):
        directory = self.root / "components/downloads"; directory.mkdir(parents=True)
        part = directory / (self.artifact["sha256"] + ".part"); part.write_bytes(b"a")
        with self.assertRaises(manager.ComponentError):
            manager.download(self.root, self.artifact, opener=lambda *a, **k: Response(self.payload[1:], status=206, headers={"Content-Range": "bytes 2-9/10"}))
        part.unlink()
        with self.assertRaises(manager.ComponentError) as bad:
            manager.download(self.root, self.artifact, opener=lambda *a, **k: Response(b"x" * len(self.payload)))
        self.assertEqual(bad.exception.code, "component_checksum")
        with self.assertRaises(manager.ComponentError):
            manager.download(self.root, self.artifact, opener=lambda *a, **k: Response(self.payload + b"x"))
        self.assertFalse(self.target().exists())

    def test_pause_keeps_partial_and_bad_protocol_path_catalog_are_rejected(self):
        (self.root / "components").mkdir(); (self.root / "components/pause").touch()
        with self.assertRaises(manager.Paused):
            manager.download(self.root, self.artifact, opener=self.opener)
        for changed in ({"url": "http://models.example.test/model"}, {"target": "../outside"}, {"sha256": "bad"}, {"target": "C:/outside"}):
            with self.assertRaises(ValueError):
                manager._artifact_valid({**self.artifact, **changed})
        messages = []
        for request in ({"type": "components:start", "componentId": "fixture"}, {"type": "components:start", "componentId": "unknown", "manual": True}, {"type": "components:start", "componentId": "fixture", "manual": True, "url": "https://evil.test/"}):
            manager.handle(request, self.root, messages.append)
        self.assertTrue(all(not result["ok"] for result in messages))

    def test_atomic_activation_rollback_and_recovery_after_shutdown(self):
        target = self.target(); target.parent.mkdir(); target.write_bytes(b"old")
        staged = Path(self.temp.name) / "new"; staged.write_bytes(self.payload)
        transaction = manager.Activation("a" * 32, self.root)
        transaction.replace(staged, target)
        self.assertEqual(target.read_bytes(), self.payload)
        # A fresh worker reconstructs its rollback from the durable journal.
        manager.recover_activations(self.root)
        self.assertEqual(target.read_bytes(), b"old")
        manager.recover_activations(self.root)
        self.assertEqual(target.read_bytes(), b"old")
        committed = manager.Activation("b" * 32, self.root)
        committed.replace(staged, target); committed.finish()
        manager.recover_activations(self.root)
        self.assertEqual(target.read_bytes(), self.payload)

    def test_real_install_flow_verifies_then_records_no_personal_cache_change(self):
        sentinel = self.root / "packs/existing"; sentinel.parent.mkdir(); sentinel.write_bytes(b"keep")
        source = Path(self.temp.name) / "download"; source.write_bytes(self.payload)
        with patch.object(manager, "download", return_value=source):
            manager.install_component(self.root, "fixture", "c" * 32)
        self.assertEqual(self.target().read_bytes(), self.payload)
        self.assertEqual(sentinel.read_bytes(), b"keep")
        state = manager.snapshot(self.root)
        self.assertTrue(state["components"][0]["verified"])
        self.item["version"] = "3"
        self.assertEqual(manager.snapshot(self.root)["components"][0]["status"], "update_available")

    def test_unknown_interrupted_claim_is_paused_and_resume_is_explicit(self):
        manager._atomic(self.root / "components/job.json", {"jobId": "d"*32, "componentId": "fixture", "status": "running", "updatedAt": time.time()-100})
        self.assertEqual(manager.snapshot(self.root)["job"]["status"], "paused")
        with patch.object(manager.subprocess, "Popen", side_effect=AssertionError("auto-start")):
            manager.snapshot(self.root)

    def test_busy_and_competing_launch_do_not_corrupt_existing_job(self):
        with self.assertRaises(manager.ComponentError):
            manager.start(self.root, {"manual": True, "componentId": "fixture"}, busy=True)
        manager._atomic(self.root / "components/job.json", {"jobId": "e"*32, "componentId": "fixture", "status": "starting", "updatedAt": time.time()})
        with self.assertRaises(manager.ComponentError):
            manager.start(self.root, {"manual": True, "componentId": "fixture"})
        self.assertEqual(manager._read(self.root / "components/job.json")["status"], "starting")

    def test_archive_path_traversal_fails_before_any_outside_file(self):
        archive = Path(self.temp.name) / "unsafe.zip"
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("../outside.exe", b"bad")
        with self.assertRaises(ValueError):
            manager.extract_archive(self.root, {**self.artifact, "archive": "zip"}, archive, self.root / "stage")
        self.assertFalse((self.root / "outside.exe").exists())

    def test_worker_uses_shared_activity_locks_and_releases_after_error(self):
        directory = self.root / "components"; directory.mkdir()
        operation = "f"*32
        manager._atomic(directory / "job.json", {"jobId": operation, "componentId": "fixture", "status": "starting"})
        with patch.object(updater, "installing", return_value=False), patch.object(manager, "install_component", side_effect=manager.Paused()):
            manager.worker(self.root, operation)
        self.assertEqual(manager.snapshot(self.root)["job"]["status"], "paused")
        locks = updater.activity_locks(self.root)
        for lock in locks: lock.release()
        self.assertFalse(manager.is_active(self.root))

    def test_native_status_protocol_stays_cold_with_isolated_cache(self):
        payload = json.dumps({"type": "components:status", "requestId": "fixture-status"}).encode()
        output = subprocess.run([sys.executable, "-B", str(HELPER / "native_host.py")], input=struct.pack("<I", len(payload)) + payload,
                                capture_output=True, timeout=15, env={**os.environ, "IKNOW_READER_CACHE": str(self.root)})
        self.assertEqual(output.returncode, 0, output.stderr.decode(errors="replace"))
        length = struct.unpack("<I", output.stdout[:4])[0]
        response = json.loads(output.stdout[4:4+length]); self.assertTrue(response["ok"])
        self.assertEqual(response["type"], "components:result")
        self.assertFalse((self.root / "models").exists())

    def test_voice_maintenance_only_stops_for_a_live_component_owner(self):
        import neural_speech
        marker = self.root / "neural/component-maintenance"; marker.parent.mkdir(); marker.touch()
        manager._atomic(self.root / "components/job.json", {"componentId": "voices", "status": "running"})
        self.assertFalse(neural_speech._component_maintenance(self.root))
        lock = manager.FileLock(self.root / "components/worker.lock")
        self.assertTrue(lock.acquire())
        try:
            self.assertTrue(neural_speech._component_maintenance(self.root))
        finally:
            lock.release()
        self.assertFalse(neural_speech._component_maintenance(self.root))

    def test_unchanged_voice_cache_reused_changed_model_invalidates_only_its_voice(self):
        import neural_speech, component_catalog
        female = neural_speech._cache_key("ソレ", "それ", 1, "female")
        male = neural_speech._cache_key("ソレ", "それ", 1, "male")
        identity = {"version": neural_speech.VERSION, "reading": "ソレ", "written": "それ", "speed": 1,
                    "voice": "female", "speaker": neural_speech.VOICES["female"], "parameters": neural_speech.PARAMETERS}
        self.assertEqual(female, hashlib.sha256(json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest())
        artifact = component_catalog.COMPONENTS["voices"]["artifacts"][1]
        with patch.dict(artifact, {"sha256": "a"*64}):
            self.assertNotEqual(female, neural_speech._cache_key("ソレ", "それ", 1, "female"))
            self.assertEqual(male, neural_speech._cache_key("ソレ", "それ", 1, "male"))

    def test_interrupted_receipt_and_target_roll_back_together(self):
        target = self.target(); target.parent.mkdir(); target.write_bytes(b"old weights")
        receipt = self.root / "components/installed.json"; manager._atomic(receipt, {"fixture": {"version": "old"}})
        staged = Path(self.temp.name) / "new-weights"; staged.write_bytes(self.payload)
        staged_receipt = Path(self.temp.name) / "new-receipt"; staged_receipt.write_text('{"fixture":{"version":"new"}}')
        activation = manager.Activation("1"*32, self.root)
        activation.replace(staged, target); activation.replace(staged_receipt, receipt)
        manager.recover_activations(self.root)
        self.assertEqual(target.read_bytes(), b"old weights")
        self.assertEqual(manager._read(receipt)["fixture"]["version"], "old")


if __name__ == "__main__":
    unittest.main(verbosity=2)
