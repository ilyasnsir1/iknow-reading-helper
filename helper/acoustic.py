"""Acoustic forced alignment using known Japanese text and actual iKnow audio.
No word-length timing estimates. Unresolved/low-confidence records are excluded.
"""
from __future__ import annotations
import html
import contextlib
import json
import hashlib
import functools
import math
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request

import numpy as np
import av
from engine import atomic_json, check_cancel, emit_progress, read_json, utf16_length
from process_resources import ChildLifetime, child_environment, creation_flags, worker_threads
import phoneme_alignment

AUDIO_CACHE = None
ALGORITHM_VERSION = 4
METHOD = "Whisper small / acoustic forced alignment"


def alignment_engine():
    return phoneme_alignment.ALGORITHM if phoneme_alignment.available() else "whisper-small-dtw"


def current_audio_record(record):
    return isinstance(record, dict) and record.get("alignmentAlgorithm") == ALGORITHM_VERSION and record.get("alignmentEngine") == alignment_engine()

def decode_audio(path, sampling_rate=16000):
    # PyAV 19 removed the metadata_errors keyword used by faster-whisper 1.2.1.
    # Decode directly with its current API, leaving dependencies untouched.
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=sampling_rate)
    chunks = []
    with av.open(path, mode="r") as container:
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                chunks.append(converted.to_ndarray().reshape(-1))
        for converted in resampler.resample(None):
            chunks.append(converted.to_ndarray().reshape(-1))
    assert chunks, "No decoded samples"
    return np.concatenate(chunks).astype(np.float32)


def plain(value):
    return html.unescape(re.sub(r"<[^>]*>", "", value or "")).strip()


def lexical(text):
    return "".join(c for c in unicodedata.normalize("NFKC", text) if unicodedata.category(c)[0] in "LN")


def source_characters(text):
    output = []
    for index, character in enumerate(text):
        for normalized in unicodedata.normalize("NFKC", character):
            if unicodedata.category(normalized)[0] in "LN":
                output.append((normalized, index))
    return output


# Explicit resolution of mismatched iKnow Jpan/Kana segmentation. Integers are
# lexical Jpan indexes; a (index, from, to) tuple slices a lexical Jpan token.
# These are linguistic correspondences, never timing estimates.
SPECIAL = {}


def core_signature(sentence):
    fields = [plain(sentence["cue"]["text"]), plain(sentence["response"]["text"]),
              plain(sentence["cue"]["transliterations"]["Hrkt"]), plain(sentence["cue"]["transliterations"]["Latn"])]
    encoded = "\n".join(fields).encode("utf-16-le")
    value = 2166136261
    for index in range(0, len(encoded), 2):
        value ^= encoded[index] | (encoded[index + 1] << 8)
        value = (value * 16777619) & 0xFFFFFFFF
    return f"{value:08x}"


def sentence_plan(sentence, alignment):
    sentence_id = str(sentence["cue"]["id"])
    repair = alignment.get("mappingRepair")
    japanese = plain(sentence["cue"]["text"])
    kana = re.findall(r"\S+", plain(sentence["cue"]["transliterations"]["Hrkt"]))
    roman = re.findall(r"\S+", plain(sentence["cue"]["transliterations"]["Latn"]))
    assert len(kana) == len(roman), f"Reading length mismatch {sentence_id}"
    spoken_kana = [(i, text) for i, text in enumerate(kana) if lexical(text)]
    jpan_text = repair.get("jpan", sentence["cue"]["transliterations"]["Jpan"]) if isinstance(repair, dict) else sentence["cue"]["transliterations"]["Jpan"]
    jpan_words = [lexical(word) for word in re.findall(r"\S+", plain(jpan_text)) if lexical(word)]
    original_chars = source_characters(japanese)
    original_lexical = "".join(c for c, _ in original_chars)
    assert "".join(jpan_words) == original_lexical, f"Jpan text mismatch {sentence_id}"
    cursor = 0
    jpan_charsets = []
    for word in jpan_words:
        jpan_charsets.append([source_index for _, source_index in original_chars[cursor: cursor + len(word)]])
        cursor += len(word)
    mapping = repair.get("mapping") if isinstance(repair, dict) else repair
    if mapping is None:
        assert len(jpan_words) == len(spoken_kana), f"Unresolved segmentation {sentence_id}"
        mapping = [[index] for index in range(len(jpan_words))]
    assert len(mapping) == len(spoken_kana), f"Manual mapping length {sentence_id}"
    units = []
    for (kana_index, kana_word), selected in zip(spoken_kana, mapping):
        positions = []
        for selection in selected:
            if isinstance(selection, int):
                positions.extend(jpan_charsets[selection])
            else:
                word_index, start, end = selection
                positions.extend(jpan_charsets[word_index][start:end])
        assert positions, f"Empty word {sentence_id}/{kana_index}"
        positions = sorted(set(positions))
        units.append({"index": kana_index, "indices": [kana_index], "startChar": min(positions), "endChar": max(positions) + 1,
                      "ja": [[min(positions), max(positions) + 1]], "kana": kana_word})
    assert sorted(i for unit in units for i in range(unit["startChar"], unit["endChar"]) if lexical(japanese[i])) == [i for _, i in original_chars], f"Character coverage {sentence_id}"
    # Suppressed numeric suffixes are combined with their displayed predecessor.
    pronunciation = alignment.get("pronunciation", {})
    combined = []
    for unit in units:
        if pronunciation.get(str(unit["index"])) == "":
            assert combined, f"No previous number {sentence_id}"
            combined[-1]["endChar"] = unit["endChar"]
            combined[-1]["indices"].append(unit["index"])
            combined[-1]["ja"] = [[combined[-1]["startChar"], unit["endChar"]]]
            combined[-1]["kana"] += " " + unit["kana"]
        else:
            combined.append(unit)
    # Keep native punctuation between word starts so the forced transcript is
    # exactly the source Japanese, while BPE boundaries respect display words.
    for index, unit in enumerate(combined):
        start = unit["startChar"] if index else 0
        end = combined[index + 1]["startChar"] if index + 1 < len(combined) else len(japanese)
        unit["text"] = japanese[start:end]
    assert "".join(unit["text"] for unit in combined) == japanese, f"Transcript reconstruction {sentence_id}"
    return {"id": sentence_id, "japanese": japanese, "kana": kana, "roman": roman, "units": combined,
            "signature": alignment["signature"], "sound": sentence["sound"], "audioPath": urllib.parse.urlparse(sentence["sound"]).path}


_DOWNLOAD_PROGRAM = r'''
import json, re, sys, urllib.error, urllib.parse, urllib.request
try:
    value = json.loads(sys.stdin.buffer.read(24000).decode("utf8"))
    request = urllib.request.Request(value["url"], headers={"User-Agent": "iKnow-Reading-Helper local alignment"})
    with urllib.request.urlopen(request, timeout=30) as response:
        final = urllib.parse.urlparse(response.geturl())
        if (final.scheme != "https" or not re.fullmatch(r"assets\d*\.iknow\.jp", final.hostname or "")
                or not final.path.startswith("/assets/") or not final.path.lower().endswith(".mp3")
                or final.username or final.password or final.fragment):
            raise ValueError("Unsupported audio redirect")
        total = 0
        with open(value["temporary"], "xb") as output:
            while True:
                chunk = response.read(65536)
                if not chunk:
                    break
                total += len(chunk)
                if total > 8 * 1024 * 1024:
                    raise ValueError("Audio response is too large")
                output.write(chunk)
        if total < 100:
            raise ValueError("Audio response is too small")
    print('{"ok":true}', flush=True)
except Exception as error:
    # A small fixed result cannot fill the pipe while the parent polls. Do not
    # include source URLs, request headers or local paths in a browser error.
    code = getattr(error, "code", None)
    connection = not isinstance(error, urllib.error.HTTPError) and isinstance(error, (urllib.error.URLError, TimeoutError, ConnectionError))
    print(json.dumps({"ok":False,"error":type(error).__name__,"status":code if isinstance(code,int) else None,"connection":connection}), flush=True)
    sys.exit(1)
'''


class AudioConnectionError(OSError):
    """A failed network connection, rather than one missing source recording."""


class AudioPreparationOffline(InterruptedError):
    """Pause once after retrying an unavailable connection, retaining progress."""
    code = "network_unavailable"

    def __init__(self):
        super().__init__("Audio preparation paused because the recording server could not be reached. Reconnect and choose Resume; completed results are kept.")


def _fetch_audio(url, temporary, cancel):
    """Run blocking connect/read outside the model-owning native process.

    urllib's socket timeout alone cannot interrupt DNS/connect/read promptly.
    The tiny stdlib child owns only this request and this unique .part file;
    pausing can therefore reap it without affecting another course or voice.
    """
    check_cancel(cancel)
    process = subprocess.Popen([sys.executable, "-u", "-c", _DOWNLOAD_PROGRAM], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               creationflags=creation_flags(), env=child_environment())
    lifetime = ChildLifetime(process)
    try:
        process.stdin.write(json.dumps({"url": url, "temporary": str(temporary)}, ensure_ascii=False).encode("utf8"))
        process.stdin.close()
        deadline = time.monotonic() + 45
        while process.poll() is None:
            if cancel.wait(.05):
                raise InterruptedError("Preparation stopped.")
            if time.monotonic() > deadline:
                raise AudioConnectionError("Downloading the recording timed out.")
        check_cancel(cancel)
        result = process.stdout.read(1024)
        if process.returncode:
            try:
                detail = json.loads(result)
                status = detail.get("status")
                connection = detail.get("connection") is True
            except (ValueError, TypeError, AttributeError):
                status, connection = None, False
            if connection:
                raise AudioConnectionError("The recording server could not be reached.")
            suffix = f" (HTTP {status})" if type(status) is int else ""
            raise OSError("The recording could not be downloaded" + suffix + ".")
        if not temporary.is_file() or not 100 <= temporary.stat().st_size <= 8 * 1024 * 1024:
            raise ValueError("The audio response has an invalid size.")
    finally:
        try:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=1)
        finally:
            lifetime.close()
            process.stdout.close()
            if not process.stdin.closed:
                with contextlib.suppress(OSError):
                    process.stdin.close()


def download_audio(plan, cancel=None):
    cancel = cancel if cancel is not None else threading.Event()
    check_cancel(cancel)
    target = audio_file(plan)
    if not target.is_file() or target.stat().st_size < 100:
        parsed = urllib.parse.urlparse(plan["sound"])
        if parsed.scheme != "https" or not re.fullmatch(r"assets\d*\.iknow\.jp", parsed.hostname or "") or not parsed.path.startswith("/assets/") or not parsed.path.lower().endswith(".mp3") or len(parsed.query) > 2000 or parsed.fragment or parsed.username or parsed.password:
            raise ValueError("Unsupported audio source")
        last_error = None
        for attempt in range(3):
            check_cancel(cancel)
            temporary = target.with_name(target.name + "." + secrets.token_hex(8) + ".part")
            try:
                _fetch_audio(plan["sound"], temporary, cancel)
                check_cancel(cancel)
                os.replace(temporary, target)
                break
            except InterruptedError:
                raise
            except Exception as error:
                last_error = error
                if attempt == 2:
                    if isinstance(last_error, AudioConnectionError):
                        # A disconnected PC must not retry every remaining clip
                        # in a long series. The engine carries its validated
                        # checkpoint through the normal manual-resume path.
                        raise AudioPreparationOffline() from last_error
                    raise last_error
                if cancel.wait(0.5 * (attempt + 1)):
                    raise InterruptedError("Preparation stopped.")
            finally:
                temporary.unlink(missing_ok=True)
    check_cancel(cancel)
    return target


def acoustic_alignment(plan, model, tokenizer):
    from faster_whisper.audio import pad_or_trim
    waveform = decode_audio(str(audio_file(plan)), sampling_rate=16000)
    duration = waveform.shape[0] / 16000
    assert 0.1 < duration < 29, f"Unexpected duration {duration}"
    features = model.feature_extractor(waveform)
    frames = min(features.shape[-1], 3000)
    encoded = model.encode(pad_or_trim(features))
    pieces = [tokenizer.encode(unit["text"]) for unit in plan["units"]]
    assert all(pieces), "Empty encoded word"
    text_tokens = [token for piece in pieces for token in piece]
    assert tokenizer.decode(text_tokens) == plan["japanese"], "Tokenizer text mismatch"
    result = model.model.align(encoded, tokenizer.sot_sequence, [text_tokens], [frames])[0]
    if not result.alignments:
        raise ValueError("No acoustic alignment")
    text_indices = np.array([pair[0] for pair in result.alignments], dtype=np.int32)
    time_indices = np.array([pair[1] for pair in result.alignments], dtype=np.int32)
    jumps = np.pad(np.diff(text_indices), (1, 0), constant_values=1).astype(bool)
    jump_times = time_indices[jumps] / model.tokens_per_second
    assert len(jump_times) == len(text_tokens) + 1, f"Alignment boundary count {len(jump_times)}/{len(text_tokens)}"
    boundaries = np.pad(np.cumsum([len(piece) for piece in pieces]), (1, 0))
    tokens = []
    zero = []
    probabilities = []
    for unit, start_token, end_token in zip(plan["units"], boundaries[:-1], boundaries[1:]):
        start = max(0, float(jump_times[start_token]))
        end = min(duration, float(jump_times[end_token]))
        probability = float(np.mean(result.text_token_probs[start_token:end_token]))
        probabilities.append(probability)
        if not math.isfinite(start + end + probability) or end - start < 0.015:
            zero.append(unit["index"])
        entry = {"index": unit["index"], "start": round(start, 3), "end": round(end, 3), "ja": unit["ja"]}
        if len(unit["indices"]) > 1:
            entry["indices"] = unit["indices"]
        tokens.append(entry)
    # Remove only acoustically silent edges; do not distribute interior word
    # lengths. The low energy threshold retains weak initial/final consonants.
    window = 160
    energies = np.array([np.sqrt(np.mean(waveform[start:start + window] ** 2)) for start in range(0, len(waveform), window)])
    active = np.flatnonzero(energies > max(float(energies.max()) * 0.0125, 0.00001))
    speech_start = max(0, active[0] / 100 - 0.03) if active.size else 0
    speech_end = min(duration, (active[-1] + 1) / 100 + 0.04) if active.size else duration
    tokens[0]["start"] = round(max(tokens[0]["start"], speech_start), 3)
    tokens[-1]["end"] = round(min(tokens[-1]["end"], speech_end), 3)
    # A zero-length attention span has no defensible individual boundary. Keep
    # the adjacent acoustic interval as one explicit indivisible word group.
    merged_groups = []
    cursor = 0
    while cursor < len(tokens):
        current = tokens[cursor]
        if current["end"] - current["start"] >= 0.015:
            cursor += 1
            continue
        if len(tokens) == 1:
            break
        neighbor = cursor + 1 if cursor + 1 < len(tokens) else cursor - 1
        a, b = sorted([cursor, neighbor])
        left, right = tokens[a], tokens[b]
        indices = sorted(set(left.get("indices", [left["index"]]) + right.get("indices", [right["index"]])))
        combined = {"index": indices[0], "indices": indices, "start": min(left["start"], right["start"]), "end": max(left["end"], right["end"]), "ja": left["ja"] + right["ja"]}
        tokens[a:b + 1] = [combined]
        merged_groups.append(indices)
        cursor = max(0, a - 1)
    mean_probability = float(np.mean(probabilities))
    reasons = []
    if any(token["end"] - token["start"] < 0.015 for token in tokens):
        reasons.append("unresolved zero-duration acoustic intervals")
    if mean_probability < 0.03:
        reasons.append("very low known-transcript acoustic probability")
    if any(tokens[i]["end"] > tokens[i+1]["start"] + 0.025 for i in range(len(tokens) - 1)):
        reasons.append("overlapping intervals")
    quality = {"meanProbability": round(mean_probability, 4), "minimumWordProbability": round(min(probabilities), 4), "zeroDurationIndexes": zero,
               "wordProbabilities": [round(p, 4) for p in probabilities], "mergedUnresolvedGroups": merged_groups,
               "acousticSpeechStart": round(float(speech_start), 3), "acousticSpeechEnd": round(float(speech_end), 3), "reasons": reasons}
    payload = {"signature": plan["signature"], "audioPath": plan["audioPath"], "duration": round(duration, 3), "tokens": tokens}
    return {"id": plan["id"], "algorithm": ALGORITHM_VERSION, "method": METHOD, "payload": payload, "quality": quality,
            "words": [{"indices": t.get("indices", [t["index"]]), "ja": " … ".join(plan["japanese"][a:b] for a, b in t["ja"]),
                       "kana": " ".join(plan["kana"][i] for i in t.get("indices", [t["index"]])), "start": t["start"], "end": t["end"]} for t in tokens]}


def phoneme_readings(plan, prepared):
    """Resolve native Kana plus reviewed particle/counter pronunciations."""
    overrides = prepared.get("alignment", {}).get("pronunciation", {})
    output = []
    for unit in plan["units"]:
        indices = unit["indices"]
        if any(str(i) in overrides and overrides[str(i)] != plan["roman"][i] for i in indices):
            roman = "".join(overrides.get(str(i), plan["roman"][i]) for i in indices)
            reading = phoneme_alignment.roman_kana(roman)
            if not reading:
                raise ValueError("The reviewed pronunciation cannot be converted to known Kana.")
        else:
            parts = []
            written = "".join(plan["japanese"][a:b] for a, b in unit["ja"])
            for i in indices:
                reading = phoneme_alignment.kana(plan["kana"][i])
                if reading == "を":
                    reading = "お"
                elif reading == "は" and not re.search("[歯葉刃]", written):
                    reading = "わ"
                elif reading == "へ" and "屁" not in written:
                    reading = "え"
                parts.append(reading)
            reading = "".join(parts)
        output.append(reading)
    return output


def phoneme_acoustic_alignment(plan, prepared, cancel, root):
    measured = phoneme_alignment.align(audio_file(plan), phoneme_readings(plan, prepared), cancel=cancel, cache_root=root)
    tokens = []
    for unit, word in zip(plan["units"], measured["tokens"]):
        entry = {"index": unit["index"], "start": word["start"], "end": word["end"], "ja": unit["ja"]}
        if len(unit["indices"]) > 1:
            entry["indices"] = unit["indices"]
        tokens.append(entry)
    return {"id": plan["id"], "algorithm": ALGORITHM_VERSION, "method": measured["method"],
            "payload": {"signature": plan["signature"], "audioPath": plan["audioPath"], "duration": measured["duration"], "tokens": tokens},
            "quality": measured["quality"],
            "words": [{"indices": unit["indices"], "ja": " … ".join(plan["japanese"][a:b] for a, b in unit["ja"]),
                       "kana": reading, "start": word["start"], "end": word["end"]}
                      for unit, reading, word in zip(plan["units"], phoneme_readings(plan, prepared), measured["tokens"])]}


def audio_file(plan):
    audio_key = hashlib.sha256(plan["sound"].encode()).hexdigest()[:12]
    return AUDIO_CACHE / f"{plan['id']}-{plan['signature']}-{audio_key}.mp3"


def native_reading_map(sentence):
    """Resolve only unique kana-anchored boundaries, without an LLM or timings.

    iKnow sometimes combines several Japanese words into one reading token, or
    splits an inflected word differently. Literal kana anchor the boundaries;
    an ambiguous split inside kanji is deliberately rejected.
    """
    japanese = sentence["japanese"]
    positions = [i for i, char in enumerate(japanese) if lexical(char)]
    if not 0 < len(positions) <= 240:
        raise ValueError("No unambiguous native reading mapping.")
    def kana(value):
        value = lexical(value)
        return "".join(chr(ord(char) - 0x60) if '\u30a1' <= char <= '\u30f6' else char for char in value)
    def kanji(char):
        return '\u3400' <= char <= '\u9fff' or '\U00020000' <= char <= '\U0003134f' or char in '々〆'
    letters = [kana(japanese[i]) for i in positions]
    spoken = [(i, kana(word)) for i, word in enumerate(re.findall(r"\S+", sentence["kana"])) if lexical(word)]
    if not 0 < len(spoken) <= 60:
        raise ValueError("No unambiguous native reading mapping.")
    boundaries = {0, len(positions)}
    jpan = [lexical(word) for word in sentence["jpan"].split() if lexical(word)]
    if "".join(jpan) == lexical(japanese):
        offset = 0
        for word in jpan:
            offset += len(word)
            boundaries.add(offset)
    for i in range(1, len(positions)):
        if not (kanji(japanese[positions[i - 1]]) and kanji(japanese[positions[i]])):
            boundaries.add(i)

    @functools.lru_cache(maxsize=None)
    def compatible(a, b, reading):
        pieces, in_kanji = [], False
        for index in range(a, b):
            if kanji(japanese[positions[index]]):
                if not in_kanji:
                    pieces.append('.+')
                in_kanji = True
            else:
                pieces.append(re.escape(letters[index]))
                in_kanji = False
        return re.fullmatch(''.join(pieces), reading) is not None

    @functools.lru_cache(maxsize=None)
    def solve(token, start):
        if token == len(spoken):
            return [()] if start == len(positions) else []
        found = []
        remaining = len(spoken) - token - 1
        for end in sorted(boundaries):
            if end <= start or end > len(positions) - remaining or not compatible(start, end, spoken[token][1]):
                continue
            for suffix in solve(token + 1, end):
                found.append(((start, end),) + suffix)
                if len(found) > 1:
                    return found
        return found
    answers = solve(0, 0)
    if len(answers) != 1:
        raise ValueError("Reading boundaries are ambiguous; this passage will remain unmarked.")
    return [{"tokens": [index], "japanese": japanese[positions[a]:positions[b - 1] + 1]}
            for (index, reading), (a, b) in zip(spoken, answers[0])]


def build_plan(sentence, prepared):
    """Prefer exact native boundaries; use validated local-model mapping if needed."""
    alignment = prepared["alignment"]
    raw = {"cue": {"id": sentence["id"], "text": sentence["japanese"], "transliterations": {"Hrkt": sentence["kana"], "Latn": sentence["roman"], "Jpan": sentence["jpan"]}}, "response": {"text": sentence["english"]}, "sound": sentence["sound"]}
    try:
        return sentence_plan(raw, alignment)
    except (AssertionError, KeyError, ValueError):
        pass
    japanese, kana, roman = sentence["japanese"], re.findall(r"\S+", sentence["kana"]), re.findall(r"\S+", sentence["roman"])
    original = source_characters(japanese)
    source_lexical = "".join(c for c, _ in original)
    spoken = [i for i, word in enumerate(kana) if lexical(word)]
    mapping = prepared.get("mapping", [])
    try:
        mapping = native_reading_map(sentence)
    except ValueError:
        pass
    if not isinstance(mapping, list) or not mapping:
        raise ValueError("No reliable mapping between Japanese text and reading.")
    units, cursor, covered = [], 0, []
    for entry in mapping:
        text, indices = entry.get("japanese"), entry.get("tokens")
        # A punctuation-only reading has no spoken word and needs no interval.
        if isinstance(text, str) and not lexical(text) and isinstance(indices, list) and all(type(i) is int and 0 <= i < len(kana) and not lexical(kana[i]) for i in indices):
            continue
        if not isinstance(text, str) or not lexical(text) or not isinstance(indices, list) or not indices:
            raise ValueError("Invalid reading mapping.")
        if any(type(i) is not int or i not in spoken for i in indices) or sorted(set(indices)) != indices:
            raise ValueError("Invalid reading indices.")
        if spoken[len(covered):len(covered) + len(indices)] != indices:
            raise ValueError("Reading mapping is not in source order.")
        normalized = lexical(text)
        if source_lexical[cursor:cursor + len(normalized)] != normalized:
            raise ValueError("Reading mapping does not match the original text.")
        positions = sorted(set(i for _, i in original[cursor:cursor + len(normalized)]))
        cursor += len(normalized)
        covered.extend(indices)
        units.append({"index": indices[0], "indices": indices, "startChar": positions[0], "endChar": positions[-1] + 1, "ja": [[positions[0], positions[-1] + 1]], "kana": " ".join(kana[i] for i in indices)})
    if cursor != len(original) or covered != spoken:
        raise ValueError("Reading mapping is incomplete.")
    for i, unit in enumerate(units):
        start = unit["startChar"] if i else 0
        end = units[i + 1]["startChar"] if i + 1 < len(units) else len(japanese)
        unit["text"] = japanese[start:end]
    if "".join(unit["text"] for unit in units) != japanese:
        raise ValueError("The audio transcript could not be reconstructed exactly.")
    return {"id": sentence["id"], "japanese": japanese, "kana": kana, "roman": roman, "units": units, "signature": sentence["signature"], "sound": sentence["sound"], "audioPath": urllib.parse.urlparse(sentence["sound"]).path}


def prepare_audio(sentences, prepared, root, config, emit, cancel):
    global AUDIO_CACHE
    AUDIO_CACHE = root / "audio"
    AUDIO_CACHE.mkdir(parents=True, exist_ok=True)
    cache = root / "audio-alignments"
    cache.mkdir(parents=True, exist_ok=True)
    plans, accepted, excluded = [], {}, []
    has_phoneme_aligner = phoneme_alignment.available()
    for sentence in sentences:
        check_cancel(cancel)
        try:
            plan = build_plan(sentence, prepared[sentence["id"]])
            # Installing the lightweight aligner also invalidates older DTW
            # checkpoints; source text and source-token mappings stay intact.
            plan["alignmentEngine"] = alignment_engine()
            plan["spokenReadings"] = prepared[sentence["id"]].get("alignment", {}).get("pronunciation", {})
            # Include the acoustic source and exact mapping, not only text hash.
            plan["sourceHash"] = hashlib.sha256(json.dumps(plan, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            prior = read_json(cache / f"{sentence['id']}-{sentence['signature']}.json")
            if prior and prior.get("algorithm") == ALGORITHM_VERSION and prior.get("sourceHash") == plan["sourceHash"] and not prior.get("quality", {}).get("reasons"):
                accepted[sentence["id"]] = prior["payload"]
            else:
                plans.append(plan)
        except (AssertionError, KeyError, ValueError) as exception:
            excluded.append({"id": sentence["id"], "reason": str(exception)})
    total = len(sentences)
    if accepted:
        emit({"type": "audio-checkpoint", "audio": dict(accepted), "completed": len(accepted) + len(excluded), "total": total})
    emit_progress(emit, "audio", len(accepted) + len(excluded), total, "Audiozeiten aus den Originalaufnahmen ermitteln …", audioExcluded=len(excluded))
    if not plans:
        return accepted, excluded
    model, tokenizer = None, None
    for plan in plans:
        check_cancel(cancel)
        try:
            download_audio(plan, cancel)
            check_cancel(cancel)
            phoneme_failure = None
            if has_phoneme_aligner:
                try:
                    result = phoneme_acoustic_alignment(plan, prepared[plan["id"]], cancel, root)
                except InterruptedError:
                    raise
                except (ValueError, OSError, RuntimeError, TimeoutError) as error:
                    phoneme_failure = str(error)
            if not has_phoneme_aligner or phoneme_failure:
                if model is None:
                    from faster_whisper import WhisperModel
                    from faster_whisper.tokenizer import Tokenizer
                    model_path = Path(config.get("whisperModel", root / "models/whisper-small"))
                    os.environ["HF_HUB_DISABLE_XET"] = "1"
                    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
                    os.environ["HF_HOME"] = str(root / "models/hf-home")
                    check_cancel(cancel)
                    # A failed optional alignment must never trigger a hidden
                    # half-gigabyte model download. Use an existing model only.
                    if not (model_path / "model.bin").is_file():
                        raise ValueError("The phoneme path was unresolved and no local fallback audio model is installed.")
                    model = WhisperModel(str(model_path), device="cpu", compute_type="int8", cpu_threads=worker_threads(), num_workers=1)
                    tokenizer = Tokenizer(model.hf_tokenizer, model.model.is_multilingual, task="transcribe", language="ja")
                result = acoustic_alignment(plan, model, tokenizer)
                if phoneme_failure:
                    result["quality"]["phonemeFallbackReason"] = phoneme_failure
            # Core's positions are JavaScript UTF-16 code units. Python's
            # acoustic mapping uses Unicode code points until this boundary.
            for token in result["payload"]["tokens"]:
                token["ja"] = [[utf16_length(plan["japanese"][:a]), utf16_length(plan["japanese"][:b])] for a, b in token["ja"]]
            result["payload"].update({"alignmentAlgorithm": ALGORITHM_VERSION, "alignmentEngine": plan["alignmentEngine"], "alignmentMethod": result["method"]})
            result["sourceHash"] = plan["sourceHash"]
            atomic_json(cache / f"{plan['id']}-{plan['signature']}.json", result)
            if result["quality"]["reasons"]:
                excluded.append({"id": plan["id"], "reason": "; ".join(result["quality"]["reasons"])})
            else:
                accepted[plan["id"]] = result["payload"]
                emit({"type": "audio-checkpoint", "audio": {plan["id"]: result["payload"]}, "completed": len(accepted) + len(excluded), "total": total})
        except InterruptedError:
            raise
        except Exception as exception:
            excluded.append({"id": plan["id"], "reason": str(exception)})
        emit_progress(emit, "audio", len(accepted) + len(excluded), total, "Audiozeiten aus den Originalaufnahmen ermitteln …", audioExcluded=len(excluded))
    del model
    return accepted, excluded

