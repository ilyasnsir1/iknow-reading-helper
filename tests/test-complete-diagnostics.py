"""Complete single-export evidence, local checks, privacy and read-only bounds."""
from pathlib import Path
import hashlib
import json
import os
import sys
import struct
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HELPER = Path(__file__).resolve().parents[1] / "helper"
sys.path.insert(0, str(HELPER))
import diagnostic_checks as checks
import diagnostics
import support_events


def put(root, relative, value):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value) if isinstance(value, dict) else value, encoding="utf-8")
    return path


def snapshot(root):
    return {str(p.relative_to(root)): (p.stat().st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest())
            for p in root.rglob("*") if p.is_file()}


class CompleteDiagnosticsTests(unittest.TestCase):
    def test_private_python_isolated_path_can_start_actual_native_host(self):
        payload = json.dumps({"type": "diagnostics", "requestId": "isolated-native-export"}).encode("utf-8")
        process = subprocess.run([sys.executable, "-I", "-B", str(HELPER / "native_host.py")],
            input=struct.pack("<I", len(payload)) + payload, capture_output=True, timeout=15,
            env={**os.environ, "IKNOW_READER_CACHE": str(self.base / "isolated-missing-cache")})
        self.assertEqual(process.returncode, 0, process.stderr.decode("utf-8", errors="replace"))
        size = struct.unpack("<I", process.stdout[:4])[0]
        self.assertEqual(len(process.stdout), size + 4)
        response = json.loads(process.stdout[4:])
        self.assertTrue(response["ok"])
        self.assertEqual(response["report"]["diagnosticFormatVersion"], 2)
        self.assertFalse((self.base / "isolated-missing-cache").exists())

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="iknow-support-fixture-")
        self.base = Path(self.temp.name)
        self.app, self.cache = self.base / "SECRET account application", self.base / "cache"
        self.app.mkdir()
        self.registration = patch.object(checks, "registration", return_value={"status": "fixture", "entries": []})
        self.registration.start()

    def tearDown(self):
        self.registration.stop()
        self.temp.cleanup()

    def report(self, **kwargs):
        return diagnostics.collect(self.cache, "1.17.0", app_root=self.app, **kwargs)

    def test_missing_cache_still_has_clear_complete_sections_and_creates_nothing(self):
        before = snapshot(self.base)
        report = self.report()
        self.assertEqual(snapshot(self.base), before)
        self.assertFalse(self.cache.exists())
        self.assertEqual(report["schemaVersion"], 1)
        self.assertEqual(report["diagnosticFormatVersion"], 2)
        self.assertEqual(report["localChecks"]["managedFiles"]["status"], "baseline_unavailable")
        self.assertEqual(report["events"]["status"], "missing")
        self.assertFalse(report["collection"]["activeChecksRequested"])
        self.assertFalse(report["collection"]["modelsStarted"])
        self.assertNotIn("SECRET", json.dumps(report))

    def test_extended_export_runs_integrated_update_probe_without_touching_cache(self):
        module = types.SimpleNamespace(collect=lambda *a, **kw: {"status": "available", "providers": {"windowsCng": {"result": "valid"}}})
        with patch.dict(sys.modules, {"update_diagnostics": module}):
            before = snapshot(self.base)
            report = self.report(active_checks=True)
        self.assertEqual(snapshot(self.base), before)
        self.assertEqual(report["updates"]["activeCheck"]["providers"]["windowsCng"]["result"], "valid")
        self.assertTrue(report["collection"]["activeChecksRequested"])

    def test_failed_active_probe_keeps_other_sections_available(self):
        def failure(*a, **kw):
            raise OSError("SECRET account path and credentials")
        with patch.dict(sys.modules, {"update_diagnostics": types.SimpleNamespace(collect=failure)}):
            report = self.report(active_checks=True)
        self.assertEqual(report["updates"]["activeCheck"]["status"], "unavailable")
        self.assertEqual(report["localChecks"]["application"]["helperVersion"], "1.17.0")
        self.assertNotIn("SECRET", json.dumps(report))

    def test_critical_file_hashes_report_modified_and_missing_without_reading_models(self):
        good = put(self.app, "helper/native_host.py", "fixture source")
        changed = put(self.app, "extension/background.js", "new source")
        hashes = {"helper/native_host.py": hashlib.sha256(good.read_bytes()).hexdigest(),
                  "extension/background.js": "a" * 64, "helper/engine.py": "b" * 64,
                  "../SECRET-private-key.xml": "c" * 64}
        put(self.app, "RELEASE-FILES.json", {"version": "1.35.1", "sha256": hashes})
        before = snapshot(self.base)
        result = checks.managed_integrity(self.app)
        self.assertEqual(snapshot(self.base), before)
        self.assertEqual(result["modified"], ["extension/background.js"])
        self.assertEqual(result["missing"], ["helper/engine.py"])
        self.assertEqual(result["invalidEntries"], 1)
        self.assertFalse(result["matchesBaseline"])
        self.assertNotIn("SECRET", json.dumps(result))
        self.assertEqual(result["readBytes"], good.stat().st_size + changed.stat().st_size)
        with patch.object(checks, "MAX_HASH_BYTES", 1):
            limited = checks.managed_integrity(self.app)
        self.assertTrue(limited["truncated"])
        self.assertEqual(limited["incompleteReason"], "byte_budget")

    def test_runtime_and_proxy_configuration_exposes_only_whitelisted_facts(self):
        model = put(self.base, "SECRET model.bin", "fixture model")
        put(self.cache, "runtime-config.json", {"llamaModel": str(model), "llamaExecutable": str(self.base / "SECRET missing.exe"),
            "gpuLayers": 7, "dependencies": str(self.base), "apiKey": "SECRET token", "arbitrary": "SECRET"})
        with patch.object(checks.urllib.request, "getproxies", return_value={"https": "https://SECRET:password@host:2345"}):
            result = checks.collect(self.cache, self.app, "1.17.0")
        encoded = json.dumps(result)
        self.assertNotIn("SECRET", encoded)
        self.assertNotIn("password", encoded)
        self.assertEqual(result["runtime"]["gpuLayers"], 7)
        self.assertEqual(result["runtime"]["components"]["languageModel"]["sizeBytes"], len("fixture model"))
        self.assertEqual(result["runtime"]["components"]["languageModel"]["location"], "external")
        self.assertEqual(result["resources"]["proxy"]["configuredSchemes"], ["https"])
        self.assertFalse(result["resources"]["proxy"]["modelLoopbackUsesSystemProxy"])

    def test_technical_context_and_prior_model_log_survive_without_credentials_or_learning_text(self):
        put(self.cache, "logs/llama.previous.log", "llama: loading model\nbackend: Vulkan device ready\nERROR: model timed out\nTraceback (most recent call last):\n  File \"C:\\Users\\SECRET\\engine.py\", line 20\nTimeoutError: timed out\nERROR: --api-key SECRET token\nERROR: prompt=private learning text\nINFO: ordinary private sentence\n")
        before = snapshot(self.base)
        report = self.report()
        self.assertEqual(snapshot(self.base), before)
        previous = next(log for log in report["logs"] if log["name"] == "logs/llama.previous.log")
        encoded = json.dumps(previous)
        self.assertIn("loading model", encoded)
        self.assertIn("Vulkan device ready", encoded)
        self.assertIn("TimeoutError", encoded)
        self.assertNotIn("SECRET", encoded)
        self.assertNotIn("private learning text", encoded)
        self.assertNotIn("ordinary private sentence", encoded)
        self.assertIn("[credential-bearing diagnostic line omitted]", encoded)

    def test_job_error_chain_and_persistent_history_survive_restart_and_remain_project_only(self):
        try:
            raise TimeoutError(10060, "SECRET request and path")
        except TimeoutError as error:
            failure = support_events.exception_info(error)
        put(self.cache, "jobs/594768.json", {"status": "error", "stage": "language", "code": "model_request_timeout",
            "completed": 41, "total": 198, "startedAt": 1793222146819, "lastProgressAt": 1793222156819,
            "durationMs": 900000, "failure": failure, "requestKey": "a" * 20, "jobKey": "b" * 20,
            "features": {"german": True, "colors": True, "audio": True}, "source": "SECRET learning"})
        support_events.append(self.cache, "course", "failed", courseId="594768", failure=failure, completed=41, total=198)
        before = snapshot(self.base)
        first, second = self.report(), self.report()
        self.assertEqual(snapshot(self.base), before)
        self.assertEqual(first["jobs"][0]["startedAt"], 1793222146819)
        self.assertEqual(first["jobs"][0]["failure"]["type"], "builtins.TimeoutError")
        self.assertEqual(first["events"]["events"], second["events"]["events"])
        self.assertNotIn("SECRET", json.dumps(first))

    def test_large_logs_and_jobs_report_bounds_and_explicit_coverage(self):
        for name in diagnostics.FIXED_LOGS:
            put(self.cache, name, ("WARNING: component failed " + "x" * 500 + "\n") * 1000)
        for index in range(140):
            put(self.cache, f"jobs/{594000 + index}.json", {"status": "error", "stage": "audio", "completed": 1,
                "total": 200, "updatedAt": index, "message": "Component timed out."})
        report = self.report()
        self.assertLessEqual(len(json.dumps(report, ensure_ascii=False).encode()), diagnostics.MAX_REPORT)
        self.assertEqual(len(report["jobs"]), 100)
        self.assertTrue(report["limits"]["jobsTruncated"])
        self.assertTrue(all(log["truncated"] for log in report["logs"]))
        self.assertEqual(report["jobs"][0]["updatedAt"], 139)

    @unittest.skipUnless(os.name == "nt", "Registry view protocol is Windows-only")
    def test_native_registration_reports_wrong_folder_without_paths_or_executing_launcher(self):
        self.registration.stop()
        native = put(self.app, "helper/native_host.py", "raise RuntimeError('must not execute')")
        launcher = put(self.base, "host.cmd", '@echo off\n"C:\\SECRET\\python.exe" -u "' + str(native) + '"\n')
        manifest = put(self.base, "host.json", {"name": checks.HOST, "type": "stdio", "path": str(launcher),
                                               "allowed_origins": ["chrome-extension://" + "a" * 32 + "/"]})
        class Key:
            def __enter__(self): return self
            def __exit__(self, *_): pass
        def open_key(hive, path, _, flags):
            if hive == 1 and "BraveSoftware" in path and flags == 16 | 4:
                return Key()
            raise FileNotFoundError()
        registry = types.SimpleNamespace(HKEY_CURRENT_USER=1, HKEY_LOCAL_MACHINE=2, KEY_WOW64_32KEY=4, KEY_WOW64_64KEY=8,
            KEY_READ=16, REG_SZ=1, REG_EXPAND_SZ=2, OpenKey=open_key, QueryValueEx=lambda *_: (str(manifest), 1))
        with patch.dict(sys.modules, {"winreg": registry}):
            result = checks.registration(self.app)
            wrong = checks.registration(self.base / "other app")
        self.assertTrue(result["entries"][0]["matchesRunningApplication"])
        self.assertFalse(wrong["entries"][0]["matchesRunningApplication"])
        self.assertNotIn("SECRET", json.dumps(result))
        self.assertNotIn("chrome-extension", json.dumps(result))
        self.registration.start()


if __name__ == "__main__":
    unittest.main(verbosity=2)
