"""Small, offline Japanese phoneme alignment using PySegmentKit's Julius assets.

The known spoken Kana is aligned to the original recording. No speech is
generated, no network is used, and uncertain/unsupported phoneme paths fail.
PySegmentKit is optional; the caller can retain its older Whisper fallback.
"""
from __future__ import annotations

import importlib.util
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import unicodedata
import wave

from process_resources import ChildLifetime, creation_flags, child_environment

ALGORITHM = "julius-jp-triphone-v1"
METHOD = "Japanese phoneme forced alignment / Julius triphone"
MAX_AUDIO_SECONDS = 120


class AlignmentUnavailable(RuntimeError):
    pass


def available():
    try:
        return importlib.util.find_spec("PySegmentKit") is not None
    except (ImportError, ValueError):
        return False


def _cancelled(cancel):
    return cancel is not None and (cancel.is_set() if hasattr(cancel, "is_set") else bool(cancel()))


def _check_cancel(cancel):
    if _cancelled(cancel):
        raise InterruptedError("Preparation stopped.")


def kana(value):
    """Normalize the supplied reading, never infer a reading from Kanji."""
    if not isinstance(value, str) or not 0 < len(value) <= 160:
        raise ValueError("Invalid spoken reading.")
    value = unicodedata.normalize("NFKC", value)
    value = "".join(chr(ord(c) - 0x60) if "\u30a1" <= c <= "\u30f6" else c for c in value)
    value = "".join(c for c in value if not c.isspace() and not unicodedata.category(c).startswith("P"))
    if not value or not re.fullmatch(r"[\u3041-\u3096ー]+", value):
        raise ValueError("A known Kana reading is required for phoneme alignment.")
    return value


def roman_kana(value):
    """Strict Hepburn conversion for already reviewed pronunciation overrides."""
    if not isinstance(value, str) or len(value) > 160:
        return None
    text = re.sub(r"[.,!?;:\s-]", "", value.lower().replace("’", "'"))
    if not re.fullmatch(r"[a-z']+", text):
        return None
    syllables = {}
    rows = {"": "あいうえお", "k": "かきくけこ", "g": "がぎぐげご", "s": "さしすせそ", "z": "ざじずぜぞ",
            "t": "たちつてと", "d": "だぢづでど", "n": "なにぬねの", "h": "はひふへほ", "b": "ばびぶべぼ",
            "p": "ぱぴぷぺぽ", "m": "まみむめも", "r": "らりるれろ"}
    for consonant, row in rows.items():
        syllables.update({consonant + vowel: char for vowel, char in zip("aiueo", row)})
    syllables.update({"shi": "し", "chi": "ち", "tsu": "つ", "ji": "じ", "fu": "ふ", "ja": "じゃ", "ju": "じゅ", "jo": "じょ",
                      "ya": "や", "yu": "ゆ", "yo": "よ", "wa": "わ", "wo": "お", "wi": "うぃ", "we": "うぇ", "she": "しぇ", "che": "ちぇ", "je": "じぇ",
                      "ti": "てぃ", "di": "でぃ", "tu": "とぅ", "du": "どぅ", "fa": "ふぁ", "fi": "ふぃ", "fe": "ふぇ", "fo": "ふぉ", "va": "ゔぁ", "vi": "ゔぃ", "vu": "ゔ", "ve": "ゔぇ", "vo": "ゔぉ"})
    for stem, first in {"ky": "き", "gy": "ぎ", "sh": "し", "sy": "し", "ch": "ち", "ty": "ち", "jy": "じ", "j": "じ", "ny": "に", "hy": "ひ", "by": "び", "py": "ぴ", "my": "み", "ry": "り"}.items():
        syllables.update({stem + vowel: first + small for vowel, small in {"a": "ゃ", "u": "ゅ", "o": "ょ"}.items()})
    output, i = [], 0
    while i < len(text):
        char, next_char = text[i], text[i + 1:i + 2]
        if char == "n" and next_char == "'":
            output.append("ん"); i += 2; continue
        if char == next_char and char not in "aeioun":
            output.append("っ"); i += 1; continue
        if char == "n" and (not next_char or next_char == "n" or next_char not in "aiueoy"):
            output.append("ん"); i += 1; continue
        for size in (3, 2, 1):
            piece = text[i:i + size]
            if piece in syllables:
                output.append(syllables[piece]); i += len(piece); break
        else:
            return None
    return "".join(output) or None


def _decode(source):
    import av
    import numpy as np
    chunks = []
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
    with av.open(str(source), mode="r") as container:
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                chunks.append(converted.to_ndarray().reshape(-1))
            if sum(len(chunk) for chunk in chunks) > 16000 * MAX_AUDIO_SECONDS:
                raise ValueError("Recording is too long for word alignment.")
        for converted in resampler.resample(None):
            chunks.append(converted.to_ndarray().reshape(-1))
    if not chunks:
        raise ValueError("No decoded audio samples.")
    samples = np.concatenate(chunks).astype(np.float32)
    if not np.isfinite(samples).all() or not .1 <= len(samples) / 16000 <= MAX_AUDIO_SECONDS:
        raise ValueError("Invalid recording duration or samples.")
    return np.clip(samples * 32767, -32768, 32767).astype("<i2").tobytes(), len(samples) / 16000


def _phone(value):
    # Julius prints triphone context, and sometimes an equivalent model alias.
    return value.split("[", 1)[0].rsplit("-", 1)[-1].split("+", 1)[0]


def _parse(log, phone_words, duration):
    rows, reading = [], False
    for line in log.splitlines():
        if "begin forced alignment" in line:
            reading = True
        elif "end forced alignment" in line:
            reading = False
        elif reading:
            match = re.fullmatch(r"\s*\[\s*(\d+)\s+(\d+)\]\s+(-?[\d.]+)\s+(\S+)\s*", line)
            if match:
                begin, end, score, label = match.groups()
                begin, end, score = int(begin), int(end), float(score)
                # 25ms feature windows on a 10ms step; same centre offset as
                # the official segmentation kit, rather than a guessed margin.
                start = begin * .01 + (.0125 if begin else 0)
                stop = (end + 1) * .01 + .0125
                if not math.isfinite(score) or not 0 <= start < stop <= duration + .05 or rows and start < rows[-1]["end"] - 1e-6:
                    raise ValueError("Invalid or overlapping phoneme path.")
                rows.append({"start": start, "end": stop, "phone": _phone(label), "score": score})
    expected = ["silB", *[p for word in phone_words for p in word], "silE"]
    if [row["phone"] for row in rows] != expected:
        raise ValueError("The exact spoken phonemes could not be aligned.")
    words, offset = [], 1
    for index, phones in enumerate(phone_words):
        selected = rows[offset:offset + len(phones)]
        words.append({"index": index, "start": round(selected[0]["start"], 4), "end": round(min(duration, selected[-1]["end"]), 4), "phones": list(phones)})
        offset += len(phones)
    if any(row["end"] - row["start"] < .015 for row in words):
        raise ValueError("An individual word has no resolvable phoneme duration.")
    spoken = rows[1:-1]
    quality = {"reasons": [], "phoneCount": len(spoken), "timeResolutionSeconds": .01,
               "minimumPhoneDuration": round(min(row["end"] - row["start"] for row in spoken), 4),
               "meanAcousticScore": round(sum(row["score"] for row in spoken) / len(spoken), 4),
               "note": "An acoustic path is not a guarantee of perceptually perfect boundaries."}
    return words, quality


def align(source_path, spoken_kana_tokens, cancel=None, cache_root=None):
    """Return measured per-word bounds for known readings, or fail explicitly.

    ``index`` refers to the supplied reading list; the caller restores any merged
    source-token indices. cache_root only locates temporary work, deleted on exit.
    """
    _check_cancel(cancel)
    if not isinstance(spoken_kana_tokens, list) or not 0 < len(spoken_kana_tokens) <= 100:
        raise ValueError("Invalid spoken word list.")
    readings = [kana(value) for value in spoken_kana_tokens]
    try:
        from PySegmentKit import PySegmentKit
    except ImportError as error:
        raise AlignmentUnavailable("The optional Japanese phoneme aligner is not installed.") from error
    kit = PySegmentKit(".", triphone=True)
    if not kit.julius_path.is_file() or not kit.hmmdefs.is_file() or not kit.hlist.is_file():
        raise AlignmentUnavailable("The Japanese phoneme aligner assets are incomplete.")
    phone_words = [PySegmentKit.yomi2voca(value).split() for value in readings]
    if any(not phones for phones in phone_words):
        raise ValueError("A word has no spoken phonemes.")
    encoded, duration = _decode(Path(source_path).resolve(strict=True))
    _check_cancel(cancel)
    parent = None
    if cache_root is not None:
        parent = Path(cache_root) / "phoneme-work"
        parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="japanese-", dir=parent) as directory:
        directory = Path(directory)
        wav_path, dict_path, dfa_path, log_path = [directory / f"speech.{suffix}" for suffix in ("wav", "dict", "dfa", "log")]
        with wave.open(str(wav_path), "wb") as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000); wav.writeframes(encoded)
        words = [["silB"], *phone_words, ["silE"]]
        dict_path.write_text("".join(f"{index} [w_{index}] {' '.join(phones)}\n" for index, phones in enumerate(words)), encoding="ascii")
        dfa_path.write_text("".join(f"{index} {len(words) - index - 1} {index + 1} 0 {1 if index == 0 else 0}\n" for index in range(len(words))) + f"{len(words)} -1 -1 1 0\n", encoding="ascii")
        command = [str(kit.julius_path), "-h", str(kit.hmmdefs), "-hlist", str(kit.hlist), "-dfa", str(dfa_path), "-v", str(dict_path), "-palign", "-input", "file"]
        if os.name != "nt":
            kit.julius_path.chmod(0o755)
        with log_path.open("wb") as log:
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT,
                                       creationflags=creation_flags(), env=child_environment())
            lifetime = ChildLifetime(process)
            try:
                process.stdin.write((str(wav_path) + "\n").encode("utf8")); process.stdin.close()
                deadline = time.monotonic() + 30
                while process.poll() is None:
                    _check_cancel(cancel)
                    if time.monotonic() > deadline:
                        raise TimeoutError("Japanese phoneme alignment took too long.")
                    time.sleep(.025)
                if process.returncode:
                    raise ValueError("Japanese phoneme alignment failed.")
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill(); process.wait(timeout=2)
                lifetime.close()
        _check_cancel(cancel)
        if log_path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError("Unexpected phoneme alignment output.")
        bounds, quality = _parse(log_path.read_text(encoding="utf8", errors="replace"), phone_words, duration)
    return {"algorithm": ALGORITHM, "method": METHOD, "duration": round(duration, 4), "tokens": bounds, "quality": quality}
