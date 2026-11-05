from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "helper"))
import neural_speech
import noji_reading


def phrase(*values):
    return {"moras": [{"consonant": consonant, "vowel": vowel, "text": text} for consonant, vowel, text in values]}


class NojiReadingTests(unittest.TestCase):
    def test_reading_uses_spoken_particle_and_does_not_synthesize(self):
        query = {"accent_phrases": [
            phrase(("t", "o", "ト"), (None, "i", "イ"), ("r", "e", "レ"), ("w", "a", "ワ")),
            phrase(("d", "o", "ド"), ("k", "o", "コ"), ("d", "e", "デ"), ("s", "U", "ス"), ("k", "a", "カ"), (None, "pau", "?")),
        ]}
        client = Mock()
        client.query.return_value = query
        with tempfile.TemporaryDirectory() as temp, patch.object(noji_reading, "read", return_value=None), patch.object(neural_speech, "ensure_engine", return_value=(client, {"female": {"styleId": 1}})):
            result = neural_speech.query_reading("トイレはどこですか?", Path(temp))
        self.assertEqual(result, {"ok": True, "romaji": "toirewa dokodesuka?"})
        client.query.assert_called_once_with("トイレはどこですか?", 1)
        client.request.assert_not_called()

    def test_gemination_and_moraic_n(self):
        query = {"accent_phrases": [
            phrase(("g", "a", "ガ"), (None, "cl", "ッ"), ("k", "o", "コ"), (None, "o", "ー")),
            phrase(("h", "o", "ホ"), (None, "N", "ン"), ("y", "a", "ヤ")),
            phrase(("m", "a", "マ"), (None, "cl", "ッ"), ("ch", "i", "チ")),
        ]}
        self.assertEqual(neural_speech.romaji_from_query(query), "gakkoo hon'ya matchi")

    def test_native_queue_hides_private_error_details(self):
        received = []
        with tempfile.TemporaryDirectory() as temp, patch.object(neural_speech, "query_reading", side_effect=URLError("private text")):
            neural_speech.enqueue({"type": "noji-reading", "requestId": "reading-1", "text": "漢字"}, Path(temp), received.append, threading.Event())
            neural_speech._reading_requests.join()
        self.assertEqual(received, [{"type": "noji-reading-result", "requestId": "reading-1", "ok": False,
                                     "code": "noji_reading_failed", "error": "Could not prepare a local reading."}])

    def test_quick_reading_never_starts_the_voice_engine(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(noji_reading, "read", return_value="shashin o totte mo ii desu ka?"), patch.object(neural_speech, "ensure_engine") as engine:
            self.assertEqual(neural_speech.query_reading("写真を撮ってもいいですか？", Path(temp)), {"ok": True, "romaji": "shashin o totte mo ii desu ka?"})
            engine.assert_not_called()

    def test_kana_details(self):
        for kana, roman in [("ガッコー", "gakkoo"), ("ホンヤ", "hon'ya"), ("マッチャ", "matcha"), ("デス’", "desu"), ("シャシン", "shashin")]:
            self.assertEqual(noji_reading.romanize(kana), roman)

    def test_missing_dictionary_does_not_download_anything(self):
        with tempfile.TemporaryDirectory() as temp:
            module = Mock(OPEN_JTALK_DICT_DIR=temp.encode())
            with patch.dict(sys.modules, {"pyopenjtalk": module}):
                self.assertIsNone(noji_reading.read("写真"))
            module.run_frontend.assert_not_called()

    def test_gemination_split_between_morphemes_uses_fast_dictionary_path(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            (directory / 'sys.dic').write_bytes(b'test')
            module = Mock(OPEN_JTALK_DICT_DIR=str(directory).encode())
            module.run_frontend.return_value = [
                {'string': '写真', 'pron': 'シャシン'}, {'string': 'を', 'pron': 'ヲ'},
                {'string': '撮っ', 'pron': 'トッ'}, {'string': 'て', 'pron': 'テ'},
                {'string': 'も', 'pron': 'モ'}, {'string': 'いい', 'pron': 'イイ'},
                {'string': 'です', 'pron': 'デス’'}, {'string': 'か', 'pron': 'カ'},
                {'string': '？', 'pos': '記号', 'pron': '？'},
            ]
            with patch.dict(sys.modules, {'pyopenjtalk': module}), patch.object(neural_speech, 'ensure_engine') as engine:
                result = neural_speech.query_reading('写真を撮ってもいいですか？', directory)
            self.assertEqual(result, {'ok': True, 'romaji': 'shashin o totte mo ii desu ka?'})
            engine.assert_not_called()

    def test_reading_does_not_wait_for_or_supersede_active_voice_synthesis(self):
        started, release, spoken, read = (threading.Event() for _ in range(4))
        results = []
        def synthesize(*args, **kwargs):
            started.set()
            release.wait(3)
            return {'ok': True}
        def receive(message):
            results.append(message)
            (read if message['type'] == 'noji-reading-result' else spoken).set()
        with tempfile.TemporaryDirectory() as temp, patch.object(neural_speech, 'synthesize', side_effect=synthesize), patch.object(noji_reading, 'read', return_value='kanji'):
            try:
                neural_speech.enqueue({'type': 'word-neural', 'requestId': 'voice-active', 'text': 'ねこ', 'voice': 'female', 'speed': 1}, Path(temp), receive, threading.Event())
                self.assertTrue(started.wait(1))
                neural_speech.enqueue({'type': 'noji-reading', 'requestId': 'reading-parallel', 'text': '漢字'}, Path(temp), receive, threading.Event())
                self.assertTrue(read.wait(1))
                self.assertFalse(spoken.is_set())
                self.assertEqual(results[0]['romaji'], 'kanji')
            finally:
                release.set()
                neural_speech._requests.join()
                neural_speech._reading_requests.join()
        self.assertTrue(spoken.is_set())

    def test_fallback_has_a_short_reading_deadline(self):
        acquired = []
        class Lock:
            def __init__(self, path):
                pass
            def acquire(self, timeout):
                acquired.append(timeout)
                return False
        with tempfile.TemporaryDirectory() as temp, patch.object(noji_reading, 'read', return_value=None), patch.object(neural_speech, 'FileLock', Lock):
            at = time.monotonic()
            with self.assertRaises(neural_speech.NeuralError) as caught:
                neural_speech.query_reading('漢字', Path(temp))
        self.assertEqual(caught.exception.code, 'word_neural_busy')
        self.assertGreater(acquired[0], 0)
        self.assertLessEqual(acquired[0], neural_speech.READING_TIMEOUT)
        self.assertLess(time.monotonic() - at, 1)

    def test_native_update_waits_for_pending_reading_work(self):
        import native_host
        updater = Mock()
        speech = SimpleNamespace(_requests=SimpleNamespace(unfinished_tasks=0), _reading_requests=SimpleNamespace(unfinished_tasks=1))
        components = SimpleNamespace(is_active=lambda root: False)
        with patch.dict(sys.modules, {'updater': updater, 'component_manager': components, 'neural_speech': speech}):
            native_host.handle({'type': 'update:status', 'requestId': 'reading-update'})
            busy = updater.handle.call_args.kwargs['busy']
            self.assertTrue(busy())
            speech._reading_requests.unfinished_tasks = 0
            self.assertFalse(busy())


if __name__ == "__main__":
    unittest.main()
