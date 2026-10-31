"""Bounded public-course retrieval for the local preview, without real network."""
from pathlib import Path
import http.client
import importlib.util
import io
import json
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import URLError
from urllib.request import Request

ROOT = Path(__file__).resolve().parents[4]
spec = importlib.util.spec_from_file_location("study_preview_server", ROOT / "work/serve-study-preview.py")
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


def body(course_id):
    return json.dumps({"id": int(course_id), "goal_items": []}).encode()


class CourseProxyTests(unittest.TestCase):
    def setUp(self):
        preview.COURSE_CACHE.clear()

    def test_only_valid_numeric_ids_before_network(self):
        with patch.object(preview.COURSE_OPENER, "open") as network:
            for value in ("0", "-1", "1?url=x", "../../etc", "https://evil.test", "1000000001", "01"):
                with self.assertRaises(ValueError):
                    preview.load_course(value)
            network.assert_not_called()

    def test_fixed_host_no_credentials_and_cache(self):
        with patch.object(preview.COURSE_OPENER, "open", return_value=io.BytesIO(body("19055"))) as network:
            self.assertEqual(preview.load_course("19055"), body("19055"))
            self.assertEqual(preview.load_course("19055"), body("19055"))
            self.assertEqual(network.call_count, 1)
            request = network.call_args.args[0]
            self.assertEqual(request.full_url, "https://iknow.jp/api/v2/goals/19055")
            self.assertFalse(request.has_header("Cookie"))
            self.assertFalse(request.has_header("Authorization"))
            self.assertEqual(network.call_args.kwargs["timeout"], 20)

    def test_size_and_identity_bounds(self):
        for payload in (b"x" * (preview.MAX_COURSE_BYTES + 1), body("123"), b"<html>error</html>"):
            with patch.object(preview.COURSE_OPENER, "open", return_value=io.BytesIO(payload)):
                with self.assertRaises(ValueError):
                    preview.load_course("19055")
            self.assertEqual(preview.COURSE_CACHE, {})

    def test_cache_size_bound(self):
        def response(request, **_):
            return io.BytesIO(body(request.full_url.rsplit("/", 1)[-1]))
        with patch.object(preview.COURSE_OPENER, "open", side_effect=response):
            for value in range(100, 125):
                preview.load_course(str(value))
        self.assertEqual(len(preview.COURSE_CACHE), 20)

    def test_redirects_cannot_leave_iknow_https(self):
        handler = preview.CourseRedirects()
        for url in ("https://evil.test/19055", "http://iknow.jp/19055", "https://iknow.jp:8443/a", "https://user:pass@iknow.jp/a"):
            with self.assertRaises(URLError):
                handler.redirect_request(Request("https://iknow.jp/api/v2/goals/19055"), None, 302, "", {}, url)

    def test_loopback_routes_and_origin_guards(self):
        class Quiet(preview.Preview):
            def log_message(self, *_):
                pass
        server = preview.ThreadingHTTPServer(("127.0.0.1", 0), Quiet)
        old_port = preview.PORT
        preview.PORT = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(preview, "load_course", return_value=body("19055")) as source:
                for path, headers, expected in (
                    ("/api/courses/19055", {}, 200),
                    ("/api/courses/19055", {"Host": "evil.test"}, 403),
                    ("/api/courses/19055?url=evil", {}, 403),
                    ("/api/courses/19055", {"Sec-Fetch-Site": "cross-site"}, 403),
                    ("/api/courses/19055", {"Origin": "https://evil.test"}, 403),
                    ("/api/courses/../../Windows/win.ini", {}, 400),
                ):
                    connection = http.client.HTTPConnection("127.0.0.1", preview.PORT, timeout=2)
                    connection.request("GET", path, headers=headers)
                    response = connection.getresponse()
                    self.assertEqual(response.status, expected)
                    response.read()
                    connection.close()
                self.assertEqual(source.call_count, 1)
        finally:
            server.shutdown()
            server.server_close()
            preview.PORT = old_port


if __name__ == "__main__":
    unittest.main(verbosity=1)
