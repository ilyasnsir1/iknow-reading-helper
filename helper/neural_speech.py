"""Pinned local word voices, isolated from the course and legacy voice workers.

Only the two selected speakers on the private loopback engine are accepted.
The small supervisor owns its engine child and releases it after idle time;
closing a browser connection never interrupts another connection's speech.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
from pathlib import Path
import queue
import re
import socket
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import wave

VERSION = "aivis-1.0.0-mao-plain-nise-normal-v2-44100"
ENGINE_VERSION = "1.0.0"
HOST, PORT = "127.0.0.1", 10103
SAMPLE_RATE = 44100
MAX_DURATION, MAX_BYTES = 8.0, 705644
CACHE_MAX_FILES, CACHE_MAX_BYTES = 8000, 512 * 1024 * 1024
START_TIMEOUT, REQUEST_TIMEOUT, IDLE_SECONDS = 90, 115, 1200
VOICES = {
    "female": {"name": "Mao Plain", "speaker": "e756b8e4-b606-4e15-99b1-3f9c6a1b2317", "style": "ふつー"},
    "male": {"name": "Nise", "speaker": "bf56410a-d8e6-430d-a477-f789e16206d3", "style": "ノーマル"},
}
PARAMETERS = {"pitchScale": 0.0, "intonationScale": 1.0, "volumeScale": .75,
              "prePhonemeLength": .15, "postPhonemeLength": .15,
              "outputSamplingRate": 44100, "outputStereo": False}
_requests = queue.Queue(maxsize=1)
_queue_lock = threading.Lock()
_worker = None


class NeuralError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def clean_kana(value):
    if not isinstance(value, str) or len(value) > 80 or any(unicodedata.category(ch).startswith("C") for ch in value):
        raise ValueError("Choose one Japanese word with a published Kana reading.")
    value = unicodedata.normalize("NFKC", value).strip()
    value = re.sub(r"[ 、。・,.!?！？]+", "", value)
    if not 1 <= len(value) <= 80 or not all("\u3041" <= ch <= "\u3096" or "\u30a1" <= ch <= "\u30fa" or ch == "ー" for ch in value):
        raise ValueError("Word pronunciation must contain Japanese Kana only.")
    return "".join(chr(ord(ch) + 0x60) if "\u3041" <= ch <= "\u3096" else ch for ch in value)


def clean_japanese(value, reading):
    if value is None or value == "":
        return reading
    if not isinstance(value, str) or len(value) > 160 or any(unicodedata.category(ch).startswith("C") for ch in value):
        raise ValueError("The written Japanese word is too long.")
    value = unicodedata.normalize("NFKC", value).strip()
    if not value or not all("\u3041" <= ch <= "\u3096" or "\u30a1" <= ch <= "\u30fa" or
                            "\u3400" <= ch <= "\u9fff" or "\uf900" <= ch <= "\ufaff" or
                            ch in "ー々〆〇ヶ0123456789 " for ch in value):
        raise ValueError("The written word must contain Japanese text only.")
    return value


def clean_speed(value=.85):
    if type(value) not in (int, float) or value not in (.7, .85, 1):
        raise ValueError("Unsupported word playback speed.")
    return float(value)


def clean_voice(value):
    if not isinstance(value, str) or value not in VOICES:
        raise ValueError("Choose the female or male word voice.")
    return value


def runtime_path(root):
    return Path(root) / "neural" / "runtime" / "Windows-x64" / "run.exe"


def installed(root):
    try:
        marker = json.loads((Path(root) / "neural" / "installation.json").read_text(encoding="utf-8-sig"))
        return (runtime_path(root).is_file() and marker.get("engineVersion") == ENGINE_VERSION and
                isinstance(marker.get("voices"), list) and set(marker["voices"]) == set(VOICES))
    except (OSError, ValueError, TypeError, AttributeError):
        return False


def status(root):
    return {"ok": True, "ready": installed(root), "voiceVersion": VERSION,
            "voices": {key: value["name"] for key, value in VOICES.items()}}


def warm_import():
    # Loading these Windows DLLs while a different thread blocks in CRT stdin
    # can stall import initialization. Import them before the native read loop.
    try:
        import numpy, av
        return True
    except ImportError:
        return False


class FileLock:
    def __init__(self, path):
        self.path, self.file = Path(path), None

    def acquire(self, timeout=0):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.file = self.path.open("a+b")
        if self.path.stat().st_size == 0:
            self.file.write(b"\0"); self.file.flush()
        deadline = time.monotonic() + max(0, timeout)
        while True:
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
                if time.monotonic() >= deadline:
                    self.file.close(); self.file = None
                    return False
                time.sleep(min(.05, max(0, deadline - time.monotonic())))

    def release(self):
        if self.file is not None:
            try:
                self.file.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self.file.fileno(), fcntl.LOCK_UN)
            finally:
                self.file.close(); self.file = None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise NeuralError("word_neural_failed", "The local voice service returned an unexpected redirect.")


class Client:
    def __init__(self, deadline=None):
        self.deadline = deadline or time.monotonic() + REQUEST_TIMEOUT
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, endpoint, params=None, payload=None, limit=2000000, timeout=45):
        if endpoint not in {"version", "speakers", "audio_query", "synthesis"}:
            raise ValueError("Unknown local voice endpoint.")
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise NeuralError("word_neural_timeout", "The local word voice took too long. Please click again.")
        path = f"http://{HOST}:{PORT}/{endpoint}"
        if params:
            path += "?" + urllib.parse.urlencode(params)
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(path, data=body, method="POST" if body is not None else "GET",
                                         headers={"Content-Type": "application/json", "Accept": "application/json, audio/wav"})
        try:
            with self.opener.open(request, timeout=max(.05, min(timeout, remaining))) as response:
                data = response.read(limit + 1)
                if len(data) > limit:
                    raise ValueError("The local voice returned too much data.")
                return data
        except (socket.timeout, TimeoutError) as error:
            raise NeuralError("word_neural_timeout", "The local word voice took too long. Please click again.") from error
        except urllib.error.URLError as error:
            if isinstance(error.reason, (socket.timeout, TimeoutError)):
                raise NeuralError("word_neural_timeout", "The local word voice took too long. Please click again.") from error
            raise

    def speakers(self, timeout=3):
        version = json.loads(self.request("version", timeout=timeout, limit=2000))
        if version != ENGINE_VERSION:
            raise NeuralError("word_neural_failed", "Port 10103 is occupied by a different voice service version.")
        values = json.loads(self.request("speakers", timeout=timeout, limit=1000000))
        if not isinstance(values, list):
            raise ValueError("Invalid local speaker list.")
        result = {}
        for key, chosen in VOICES.items():
            speaker = next((item for item in values if isinstance(item, dict) and item.get("speaker_uuid") == chosen["speaker"]), None)
            styles = speaker.get("styles", []) if speaker else []
            style = next((item for item in styles if isinstance(item, dict) and item.get("name") == chosen["style"]), None)
            if style is None or type(style.get("id")) is not int or style["id"] < 0:
                raise NeuralError("word_neural_missing", "The selected Mao Plain and Nise voices are not installed. Run Setup-neural-voice.cmd.")
            result[key] = {**chosen, "styleId": style["id"], "modelVersion": speaker.get("version", "")}
        return result

    def query(self, text, style_id):
        result = json.loads(self.request("audio_query", {"speaker": style_id, "text": text}, {}))
        phonemes(result)
        return result


def phonemes(query):
    if not isinstance(query, dict) or not isinstance(query.get("accent_phrases"), list):
        raise ValueError("The local voice returned an invalid pronunciation.")
    result = []
    for phrase in query["accent_phrases"]:
        if not isinstance(phrase, dict) or not isinstance(phrase.get("moras"), list):
            raise ValueError("The local voice returned invalid moras.")
        for mora in phrase["moras"]:
            if not isinstance(mora, dict):
                raise ValueError("The local voice returned invalid moras.")
            consonant, vowel = mora.get("consonant"), mora.get("vowel")
            if not isinstance(vowel, str) or consonant is not None and not isinstance(consonant, str):
                raise ValueError("The local voice returned invalid phonemes.")
            result.append(((consonant or "") + vowel).lower())
    if not result or len(result) > 160:
        raise ValueError("The local voice returned no usable word pronunciation.")
    return result


def _port_open():
    try:
        with socket.create_connection((HOST, PORT), timeout=.3):
            return True
    except OSError:
        return False


def _touch(root):
    directory = Path(root) / "neural"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "last-used").touch()


def _hidden_options():
    return {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}


def _open_log(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Bound logs between runs, without touching a file held by an active engine.
    if path.is_file() and path.stat().st_size > 4 * 1024 * 1024:
        path.write_bytes(b"")
    return path.open("ab", buffering=0)


def _owner_running(root):
    probe = FileLock(Path(root) / "neural" / "engine-owner.lock")
    try:
        return not probe.acquire()
    finally:
        probe.release()


def ensure_engine(root, deadline):
    directory = Path(root) / "neural"
    lock = FileLock(directory / "engine-start.lock")
    if not lock.acquire(min(START_TIMEOUT, max(0, deadline - time.monotonic()))):
        raise NeuralError("word_neural_timeout", "The local voice is still starting. Please click again.")
    try:
        client = Client(deadline)
        if _port_open():
            # Never replace or terminate an unrelated listener on the fixed port.
            return client, client.speakers()
        if not installed(root):
            raise NeuralError("word_neural_missing", "Run helper/Setup-neural-voice.cmd once to install Mao Plain and Nise.")
        _touch(root)
        supervisor = None
        if not _owner_running(root):
            with _open_log(directory / "supervisor.log") as log:
                supervisor = subprocess.Popen([sys.executable, "-u", str(Path(__file__).resolve()), "_serve", "--cache-root", str(Path(root).resolve())],
                                              stdin=subprocess.DEVNULL, stdout=log, stderr=log, close_fds=True, **_hidden_options())
        start_deadline = min(deadline, time.monotonic() + START_TIMEOUT)
        readiness = Client(start_deadline)
        while time.monotonic() < start_deadline:
            if supervisor is not None and supervisor.poll() is not None and not _owner_running(root):
                raise NeuralError("word_neural_failed", "The local voice could not start. See neural/engine.log or rerun Setup-neural-voice.cmd.")
            if _port_open():
                try:
                    return client, readiness.speakers(timeout=2)
                except (urllib.error.URLError, NeuralError):
                    # Speaker initialization may still be underway after bind.
                    pass
            time.sleep(.2)
        raise NeuralError("word_neural_timeout", "The local voice is still starting. Please click again.")
    finally:
        lock.release()


def _stop_owned(child):
    if child is not None and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill(); child.wait(timeout=5)


def _component_maintenance(root):
    directory = Path(root) / "components"
    if not (Path(root) / "neural/component-maintenance").is_file():
        return False
    try:
        value = json.loads((directory / "job.json").read_text(encoding="utf-8"))
        if value.get("componentId") != "voices" or value.get("status") not in {"running", "pausing"}:
            return False
        probe = FileLock(directory / "worker.lock")
        try:
            return not probe.acquire()
        finally:
            probe.release()
    except (OSError, ValueError, AttributeError):
        return False


def serve(root):
    """Independent supervisor: only this process may stop its owned child."""
    root = Path(root)
    directory = root / "neural"
    child = None
    owner = FileLock(directory / "engine-owner.lock")
    if not owner.acquire():
        return
    try:
        if not installed(root) or _port_open():
            return
        environment = os.environ.copy()
        environment.update(HF_HOME=str(directory / "huggingface"), HF_HUB_DISABLE_TELEMETRY="1",
                           HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
        with _open_log(directory / "engine.log") as log:
            child = subprocess.Popen([str(runtime_path(root)), "--host", HOST, "--port", str(PORT), "--output_log_utf8"],
                                     cwd=str(runtime_path(root).parent), env=environment, stdin=subprocess.DEVNULL,
                                     stdout=log, stderr=log, close_fds=True, **_hidden_options())
        while child.poll() is None:
            time.sleep(2)
            if _component_maintenance(root):
                # The explicit component installer holds synthesis/start locks;
                # only this supervisor may stop the engine child it owns.
                return
            try:
                idle = time.time() - (directory / "last-used").stat().st_mtime
            except OSError:
                idle = IDLE_SECONDS + 1
            if idle < IDLE_SECONDS:
                continue
            work = FileLock(directory / "synthesis.lock")
            start = FileLock(directory / "engine-start.lock")
            try:
                if not work.acquire() or not start.acquire():
                    continue
                if time.time() - (directory / "last-used").stat().st_mtime >= IDLE_SECONDS:
                    return
            finally:
                start.release(); work.release()
    finally:
        try:
            _stop_owned(child)
        finally:
            owner.release()


def _canonical_wav(payload):
    if not isinstance(payload, bytes) or not 100 <= len(payload) <= 2000000:
        raise ValueError("The local voice returned invalid audio.")
    with wave.open(io.BytesIO(payload), "rb") as source:
        rate, count = source.getframerate(), source.getnframes()
        if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getcomptype() != "NONE" or rate not in (24000, 44100, 48000):
            raise ValueError("The local voice returned an unsupported WAV format.")
        if not .04 <= count / rate <= MAX_DURATION:
            raise ValueError("Choose a shorter Japanese word.")
        raw = source.readframes(count)
        if len(raw) != count * 2:
            raise ValueError("The local voice returned incomplete audio.")
    import numpy as np
    samples = np.frombuffer(raw, dtype="<i2").copy()
    if not samples.size or int(np.max(np.abs(samples.astype(np.int32)))) == 0:
        raise ValueError("The local voice returned silent audio.")
    if rate != SAMPLE_RATE:
        import av
        frame = av.AudioFrame.from_ndarray(samples.reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate = rate
        resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
        frames = resampler.resample(frame) + resampler.resample(None)
        samples = np.concatenate([item.to_ndarray().reshape(-1) for item in frames])
    # At the engine's native44.1kHz, preserve every source PCM sample, matching
    # the audition files. No downsampling, gain change or denoising is applied.
    raw = samples.astype("<i2").tobytes()
    result = io.BytesIO()
    with wave.open(result, "wb") as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(SAMPLE_RATE)
        output.writeframes(raw)
    return result.getvalue()


def _wav_result(payload, voice, cached):
    if not 100 <= len(payload) <= MAX_BYTES or payload[:4] != b"RIFF" or payload[8:16] != b"WAVEfmt " or payload[36:40] != b"data":
        raise ValueError("Invalid cached word recording.")
    with wave.open(io.BytesIO(payload), "rb") as audio:
        count = audio.getnframes()
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != SAMPLE_RATE or audio.getcomptype() != "NONE" or len(payload) != 44 + count * 2:
            raise ValueError("Invalid cached word format.")
        duration = count / SAMPLE_RATE
        if not .04 <= duration <= MAX_DURATION or len(audio.readframes(count)) != count * 2:
            raise ValueError("Invalid cached word duration.")
    encoded = base64.b64encode(payload).decode("ascii")
    if len(encoded) > 950000:
        raise ValueError("The word recording is too large.")
    return {"ok": True, "data": encoded, "sampleRate": SAMPLE_RATE, "duration": round(duration, 6),
            "voice": voice, "voiceName": VOICES[voice]["name"], "voiceVersion": VERSION, "cached": cached}


def _cache_key(reading, written, speed, voice):
    identity = {"version": VERSION, "reading": reading, "written": written, "speed": speed,
                "voice": voice, "speaker": VOICES[voice], "parameters": PARAMETERS}
    # Preserve compatible existing WAVs. A later signed catalogue changing an
    # engine/model hash must use a different key even if its speaker UUID stays.
    from component_catalog import COMPONENTS
    baseline = {"Word voice engine": "ae0a52d58bc5423451229fb2f3348693c9a1121c83f0542bfb826c6e68a4fc0d",
                "Mao Plain": "f87ccea2e8e2de0e0bfe52e803945af903b4086bf25621a015111628f00e4119",
                "Nise": "6ff7eaa61c24d37434e2c6ab672fc3ba189ecc9118c08918a486ed5316e5c9d3"}
    current = {artifact["name"]: artifact["sha256"] for artifact in COMPONENTS["voices"]["artifacts"]}
    names = ("Word voice engine", VOICES[voice].get("modelName", VOICES[voice]["name"]))
    revisions = {name: current.get(name) for name in names if current.get(name) != baseline.get(name)}
    if revisions:
        identity["modelRevisions"] = revisions
    return hashlib.sha256(json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _prune(directory):
    # Prepared courses share the same512MiB/8,000-file LRU as direct clicks.
    # Preparation status checks actual retained files before claiming readiness.
    entries = sorted(((entry.stat().st_mtime, entry.stat().st_size, entry) for entry in directory.glob("*.wav")), reverse=True)
    size = 0
    for index, (_, count, entry) in enumerate(entries):
        size += count
        if index >= CACHE_MAX_FILES or size > CACHE_MAX_BYTES:
            try:
                entry.unlink(missing_ok=True)
            except OSError:
                pass


def synthesize(text, speed, root, voice="female", japanese=None):
    reading, speed, voice = clean_kana(text), clean_speed(speed), clean_voice(voice)
    written = clean_japanese(japanese, reading)
    root = Path(root)
    directory = root / "neural" / "words"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (_cache_key(reading, written, speed, voice) + ".wav")
    if target.is_file():
        try:
            if target.stat().st_size <= MAX_BYTES:
                result = _wav_result(target.read_bytes(), voice, True)
                target.touch()
                _touch(root)
                return result
        except (OSError, ValueError, wave.Error, EOFError):
            pass
        target.unlink(missing_ok=True)
    deadline = time.monotonic() + REQUEST_TIMEOUT
    _touch(root)
    lock = FileLock(root / "neural" / "synthesis.lock")
    if not lock.acquire(max(0, deadline - time.monotonic())):
        raise NeuralError("word_neural_busy", "The local word voice is busy. Please click again.")
    try:
        # Another native connection may have completed this exact word.
        if target.is_file() and target.stat().st_size <= MAX_BYTES:
            try:
                result = _wav_result(target.read_bytes(), voice, True)
                target.touch()
                return result
            except (OSError, ValueError, wave.Error, EOFError):
                target.unlink(missing_ok=True)
        client, speakers = ensure_engine(root, deadline)
        style_id = speakers[voice]["styleId"]
        kana_query = client.query(reading, style_id)
        query = kana_query
        if written != reading:
            candidate = client.query(written, style_id)
            if phonemes(candidate) == phonemes(kana_query):
                query = candidate
        query.update(PARAMETERS)
        query["speedScale"] = speed
        generated = client.request("synthesis", {"speaker": style_id}, query, limit=2000000, timeout=60)
        payload = _canonical_wav(generated)
        result = _wav_result(payload, voice, False)
        temporary = target.with_name(target.name + f".{os.getpid()}.{threading.get_ident()}.tmp")
        try:
            temporary.write_bytes(payload)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        try:
            _prune(directory)
        except OSError:
            pass
        return result
    finally:
        try:
            _touch(root)
        finally:
            lock.release()


def enqueue(message, root, send, stopping):
    envelope = {"type": "word-neural-result", "requestId": message.get("requestId")}
    try:
        text = clean_kana(message.get("text"))
        voice = clean_voice(message.get("voice", "female"))
        speed = clean_speed(message.get("speed", .85))
        written = clean_japanese(message.get("japanese"), text)
    except ValueError as error:
        send({**envelope, "ok": False, "code": "invalid_word", "error": str(error)[:200]})
        return
    global _worker
    with _queue_lock:
        # Only the latest waiting click matters. Never build a long cold-start
        # backlog; an in-flight word finishes safely, then the newest one plays.
        try:
            previous = _requests.get_nowait()
        except queue.Empty:
            previous = None
        if previous is not None:
            _requests.task_done()
            if not previous[-1].is_set():
                try:
                    previous[-2]({**previous[5], "ok": False, "code": "word_neural_superseded", "error": "A newer word was selected."})
                except (BrokenPipeError, OSError, InterruptedError):
                    pass
        _requests.put_nowait((text, speed, Path(root), voice, written, envelope, send, stopping))
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, name="neural-word-voice", daemon=True)
            _worker.start()


def _run():
    while True:
        text, speed, root, voice, written, envelope, send, stopping = _requests.get()
        try:
            if stopping.is_set():
                continue
            result = synthesize(text, speed, root, voice=voice, japanese=written)
            if not stopping.is_set():
                send({**envelope, **result})
        except Exception as error:
            if not stopping.is_set():
                code = error.code if isinstance(error, NeuralError) else "word_neural_failed"
                message = str(error)[:200] or "Could not prepare the local word pronunciation."
                if isinstance(error, urllib.error.URLError):
                    message = "The local voice service stopped. Please click again or rerun Setup-neural-voice.cmd."
                try:
                    send({**envelope, "ok": False, "code": code, "error": message})
                except (BrokenPipeError, OSError, InterruptedError):
                    pass
        finally:
            _requests.task_done()


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "_serve"])
    parser.add_argument("--cache-root", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "_serve":
        serve(args.cache_root)
    else:
        warm_import()
        for voice in VOICES:
            result = synthesize("それ", .85, args.cache_root, voice=voice, japanese="それ")
            print(f"{VOICES[voice]['name']} ready ({result['duration']:.2f}s local test recording).", flush=True)


if __name__ == "__main__":
    main()
