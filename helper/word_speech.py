"""One local Japanese word voice; no network and no sentence extraction.

The Mei HTS voice is bundled with pinned pyopenjtalk-plus. Speak only validated
pronunciation Kana supplied by the extension, never arbitrary source markup.
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import io
import math
import os
from pathlib import Path
import queue
import re
import threading
import time
import unicodedata
import wave

VERSION = "mei-openjtalk-0.4.1.post10-v1"
VOICE = "Mei / Open JTalk"
SAMPLE_RATE = 24000
MAX_DURATION = 8.0
MAX_KANA = 80
_backend = None
_backend_lock = threading.Lock()
_requests = queue.Queue(maxsize=8)
_worker = None
_worker_lock = threading.Lock()
_last_prune = 0.0


def clean_kana(value):
    if not isinstance(value, str) or len(value) > 160:
        raise ValueError("Choose one Japanese word to pronounce.")
    value = unicodedata.normalize("NFKC", value).strip()
    # Formatting marks are not speech; all other non-Kana input is rejected.
    value = re.sub(r"[\s。、，,.!?！？・]+", "", value)
    if not 1 <= len(value) <= MAX_KANA or not all("\u3041" <= ch <= "\u3096" or "\u30a1" <= ch <= "\u30fa" or ch == "ー" for ch in value):
        raise ValueError("Word pronunciation must contain Japanese Kana only.")
    return "".join(chr(ord(ch) + 0x60) if "\u3041" <= ch <= "\u3096" else ch for ch in value)


def clean_speed(value=0.85):
    if type(value) not in (int, float) or value not in (0.7, 0.85, 1):
        raise ValueError("Unsupported word playback speed.")
    return float(value)


def installed():
    return importlib.util.find_spec("pyopenjtalk") is not None


def warm_import():
    """Import Windows numerical/native DLLs before the host blocks on stdin."""
    global _backend
    try:
        import pyopenjtalk
        if str(pyopenjtalk.__version__).replace("-post", ".post") != "0.4.1.post10":
            return False
        _backend = pyopenjtalk
        return True
    except ImportError:
        return False


def _load_backend():
    global _backend
    if _backend is None:
        with _backend_lock:
            if _backend is None and not warm_import():
                raise RuntimeError("Run helper/Setup-word-voice.cmd once to install the local Japanese word voice.")
    return _backend


def _wav_result(payload, cached):
    if not 100 <= len(payload) <= 400000:
        raise ValueError("Invalid cached word recording.")
    with wave.open(io.BytesIO(payload), "rb") as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != SAMPLE_RATE or audio.getcomptype() != "NONE":
            raise ValueError("Invalid cached word format.")
        duration = audio.getnframes() / SAMPLE_RATE
        if not 0.04 <= duration <= MAX_DURATION:
            raise ValueError("Word recording is too long.")
        if len(audio.readframes(audio.getnframes())) != audio.getnframes() * 2:
            raise ValueError("Cached word recording is incomplete.")
    return {"ok": True, "data": base64.b64encode(payload).decode("ascii"), "sampleRate": SAMPLE_RATE,
            "duration": round(duration, 6), "voice": VOICE, "voiceVersion": VERSION, "cached": cached}


def _prune(directory):
    global _last_prune
    if time.monotonic() - _last_prune < 60:
        return
    _last_prune = time.monotonic()
    entries = sorted(((entry.stat().st_mtime, entry.stat().st_size, entry) for entry in directory.glob("*.wav")), reverse=True)
    size = 0
    for index, (_, count, entry) in enumerate(entries):
        size += count
        if index >= 2000 or size > 128 * 1024 * 1024:
            try:
                entry.unlink(missing_ok=True)
            except OSError:
                pass


def synthesize(text, speed, cache_root):
    text, speed = clean_kana(text), clean_speed(speed)
    directory = Path(cache_root) / "word-speech"
    directory.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(f"{VERSION}\n{speed}\n{text}".encode("utf-8")).hexdigest()
    target = directory / f"{key}.wav"
    if target.is_file():
        try:
            if target.stat().st_size <= 400000:
                return _wav_result(target.read_bytes(), True)
        except (OSError, ValueError, wave.Error, EOFError):
            pass
    backend = _load_backend()
    import numpy as np
    # Kana are already the intended spoken form. No enhanced kanji-reading
    # model, Sudachi dictionary, Marine model or network access is needed.
    waveform, rate = backend.tts(text, speed=speed, use_vanilla=True, run_marine=False,
                                 use_tsqyomi=False, use_sudachi_kanji_yomi=False, predict_nani=False)
    samples = np.asarray(waveform, dtype=np.float64)
    if samples.ndim != 1 or not np.isfinite(samples).all() or not math.isfinite(rate) or rate != 48000 or samples.size > rate * 12:
        raise ValueError("The word voice returned invalid audio.")
    peak = float(np.max(np.abs(samples))) if samples.size else 0
    if peak <= 0:
        raise ValueError("The word voice returned no speech.")
    samples = samples / peak * 0.9
    # Trim only the generated utterance's silence, retaining consonant room.
    width = 480
    energies = np.array([np.sqrt(np.mean(samples[start:start + width] ** 2)) for start in range(0, samples.size, width)])
    active = np.flatnonzero(energies > max(float(energies.max()) * .015, .00005))
    if not active.size:
        raise ValueError("The word voice returned no speech.")
    start = max(0, int(active[0] * width - rate * .035))
    end = min(samples.size, int((active[-1] + 1) * width + rate * .055))
    samples = samples[start:end]
    # The source voice emits 48 kHz; paired averaging gives a 24 kHz speech
    # stream small enough for one native-message frame even at the 8s limit.
    samples = samples[:samples.size // 2 * 2].reshape(-1, 2).mean(axis=1)
    if not .04 <= samples.size / SAMPLE_RATE <= MAX_DURATION:
        raise ValueError("Choose a shorter Japanese word.")
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(SAMPLE_RATE)
        audio.writeframes(pcm)
    payload = buffer.getvalue()
    result = _wav_result(payload, False)
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


def enqueue(message, cache_root, send, stopping):
    request_id = message.get("requestId")
    envelope = {"type": "word-speech-result", "requestId": request_id}
    try:
        text = clean_kana(message.get("text"))
        speed = clean_speed(message.get("speed", .85))
    except ValueError as error:
        send({**envelope, "ok": False, "code": "invalid_word", "error": str(error)[:200]})
        return
    global _worker
    with _worker_lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, name="word-voice", daemon=True)
            _worker.start()
    try:
        _requests.put_nowait((text, speed, Path(cache_root), envelope, send, stopping))
    except queue.Full:
        send({**envelope, "ok": False, "code": "word_voice_busy", "error": "The word voice is busy. Please click again."})


def _run():
    while True:
        text, speed, root, envelope, send, stopping = _requests.get()
        try:
            if stopping.is_set():
                continue
            result = synthesize(text, speed, root)
            if not stopping.is_set():
                send({**envelope, **result})
        except Exception as error:
            if not stopping.is_set():
                code = "word_voice_missing" if not installed() or _backend is None else "word_voice_failed"
                try:
                    send({**envelope, "ok": False, "code": code, "error": str(error)[:200] or "Could not prepare the word pronunciation."})
                except (BrokenPipeError, OSError, InterruptedError):
                    pass
        finally:
            _requests.task_done()


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check"])
    parser.add_argument("--cache-root", type=Path, required=True)
    args = parser.parse_args()
    result = synthesize("ソレ", .85, args.cache_root)
    print(f"Japanese word voice ready: {VOICE} ({result['duration']:.2f}s test recording).")


if __name__ == "__main__":
    main()
