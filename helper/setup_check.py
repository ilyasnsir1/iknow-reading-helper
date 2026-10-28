"""Read-only local installation audit. No downloads, registry edits or models.

The default audit checks files, package metadata and selected model checksums.
It does not prove inference works. Explicit --verify-audio additionally imports
the requested component's audio libraries, without loading speech/LLM models.
"""
from __future__ import annotations

import argparse
import contextlib
from email.parser import Parser
import hashlib
import importlib
import io
import json
import os
from pathlib import Path
import re
import sys

SCHEMA_VERSION = 1
ENGINE_VERSION = "1.0.0"
ENGINE_HASH = "ae0a52d58bc5423451229fb2f3348693c9a1121c83f0542bfb826c6e68a4fc0d"
QWEN_FILE = "Qwen3.5-9B-Q4_K_M.gguf"
WHISPER_FILES = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")
BERT_REPOSITORY = "models--tsukumijima--deberta-v2-large-japanese-char-wwm-onnx"
BERT_FILES = ("model.onnx", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "vocab.txt")
MODELS = (
    {"name": "Mao Plain", "uuid": "a59cb814-0083-4369-8542-f51a29e72af7", "hash": "f87ccea2e8e2de0e0bfe52e803945af903b4086bf25621a015111628f00e4119", "aliases": ("mao.aivmx",)},
    {"name": "Nise", "uuid": "6d11c6c2-f4a4-4435-887e-23dd60f8b8dd", "hash": "6ff7eaa61c24d37434e2c6ab672fc3ba189ecc9118c08918a486ed5316e5c9d3", "aliases": ("nise.aivmx",)},
)
MODULES = {
    "numpy": "numpy/__init__.py", "av": "av/__init__.py", "faster-whisper": "faster_whisper/__init__.py",
    "ctranslate2": "ctranslate2/__init__.py", "onnxruntime": "onnxruntime/__init__.py",
    "tokenizers": "tokenizers/__init__.py", "huggingface-hub": "huggingface_hub/__init__.py",
    "hf-xet": "hf_xet/__init__.py", "filelock": "filelock/__init__.py", "fsspec": "fsspec/__init__.py",
    "packaging": "packaging/__init__.py", "pyyaml": "yaml/__init__.py", "tqdm": "tqdm/__init__.py",
    "typing-extensions": "typing_extensions.py", "flatbuffers": "flatbuffers/__init__.py",
    "protobuf": "google/protobuf/__init__.py", "requests": "requests/__init__.py",
    "pyopenjtalk-plus": "pyopenjtalk/__init__.py", "pydantic": "pydantic/__init__.py",
    "pydantic-core": "pydantic_core/__init__.py", "annotated-types": "annotated_types/__init__.py",
    "typing-inspection": "typing_inspection/__init__.py", "sudachipy": "sudachipy/__init__.py",
    "pysegmentkit": "PySegmentKit/__init__.py",
}
EXPECTATIONS = {"voices": ("python", "neural"), "course": ("python", "course"),
                "legacy": ("python", "legacy"), "complete": ("python", "course", "neural", "legacy")}


def _component(detected, problems):
    return {"installed": bool(detected and not problems), "state": "ready" if detected and not problems else "partial" if detected else "missing",
            "detected": bool(detected), "problems": list(problems)}


def _file(path):
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def _read_json(path):
    try:
        if not _file(path) or path.stat().st_size > 2_000_000:
            return None
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, ValueError):
        return None


def _contained(path, root):
    try:
        resolved, base = path.resolve(), root.resolve()
        if resolved.is_relative_to(base):
            return True
        # Windows can expose a merged AppData directory to a desktop app while
        # resolving individual files into that app's MSIX LocalCache. These are
        # the same logical storage tree, not arbitrary external config paths.
        if os.name == "nt":
            local = Path(os.environ.get("LOCALAPPDATA", "__missing_local_appdata__")).resolve()
            for environment, kind in (("LOCALAPPDATA", "Local"), ("APPDATA", "Roaming")):
                parent = Path(os.environ.get(environment, "__missing_appdata__")).resolve()
                if not base.is_relative_to(parent):
                    continue
                relative = base.relative_to(parent)
                packages = local / "Packages"
                if not resolved.is_relative_to(packages):
                    continue
                parts = resolved.relative_to(packages).parts
                if len(parts) > 3 and parts[0].startswith("OpenAI.Codex_") and parts[1:3] == ("LocalCache", kind):
                    alias = packages / parts[0] / "LocalCache" / kind / relative
                    if resolved.is_relative_to(alias):
                        return True
        return False
    except (OSError, ValueError, RuntimeError):
        return False


def _required(path, label, problems, root=None):
    if root is not None and not _contained(path, root):
        problems.append(label + " resolves outside the local storage directory.")
        return False
    if not _file(path):
        problems.append(label + " is missing or empty.")
        return False
    return True


def _normal_name(value):
    return re.sub(r"[-_.]+", "-", value).lower()


def _metadata(packages):
    result = {}
    try:
        candidates = list(packages.glob("*.dist-info/METADATA"))
    except OSError:
        return result
    for candidate in candidates[:500]:
        try:
            if not _contained(candidate, packages) or candidate.stat().st_size > 500000:
                continue
            value = Parser().parsestr(candidate.read_text(encoding="utf-8"))
            name, version = value.get("Name"), value.get("Version")
            if name and version:
                result.setdefault(_normal_name(name), set()).add(version)
        except (OSError, UnicodeError, ValueError):
            continue
    return result


def _requirements(filename):
    result = {}
    try:
        lines = (Path(__file__).resolve().parent / filename).read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return result
    for line in lines:
        match = re.match(r"\s*([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+-]+)(?:\s|$)", line)
        if match:
            result[_normal_name(match[1])] = match[2]
    return result


def _packages(packages, requirements, metadata, problems):
    if not requirements:
        problems.append("The packaged dependency requirements could not be read.")
        return
    for name, version in requirements.items():
        versions = metadata.get(name, set())
        if version not in versions:
            problems.append(f"{name} {version} package metadata is missing.")
        module = MODULES.get(name)
        if module is not None:
            path = packages / module
            if not _contained(path, packages):
                problems.append(name + " module resolves outside the private packages directory.")
            elif not path.is_file():
                # Namespace packages can legitimately have an empty __init__.
                problems.append(name + " module is missing.")


def _snapshot(base, required, root):
    """Accept direct local_dir downloads or an existing contained HF snapshot."""
    candidates = [base]
    snapshots = base / "snapshots"
    try:
        reference = (base / "refs/main").read_text(encoding="ascii").strip()
        if re.fullmatch(r"[0-9a-f]{40,64}", reference):
            candidates.append(snapshots / reference)
    except (OSError, UnicodeError):
        pass
    try:
        candidates.extend(sorted((path for path in snapshots.iterdir() if path.is_dir()), key=lambda path: path.name, reverse=True)[:64])
    except OSError:
        pass
    return next((path for path in candidates if _contained(path, root) and all(_contained(path / name, root) and _file(path / name) for name in required)), None)


def _python(root, packages, metadata):
    directory = root / "runtime/python"
    detected = directory.exists() or (packages / "pip").exists()
    problems = []
    for name in ("python.exe", "python312.dll", "python312.zip", "python312._pth"):
        _required(directory / name, "Private Python " + name, problems, root)
    _required(packages / "pip/__main__.py", "Private pip", problems, root)
    try:
        lines = [line.strip() for line in (directory / "python312._pth").read_text(encoding="utf-8-sig").splitlines() if line.strip() and not line.lstrip().startswith("#")]
        entries = [line for line in lines if not line.startswith("import ")]
        if "import site" not in lines or not any((directory / line).resolve() == packages.resolve() for line in entries):
            problems.append("Private Python search paths do not enable the local packages and import site.")
        if any(not _contained(directory / line, root) for line in entries):
            problems.append("Private Python search paths leave the local storage directory.")
    except (OSError, UnicodeError, ValueError):
        problems.append("Private Python search paths cannot be read.")
    _packages(packages, _requirements("neural-voice-requirements.txt"), metadata, problems)
    return _component(detected, problems)


def _course(root, packages, metadata):
    config_path = root / "runtime-config.json"
    detected = config_path.exists() or (root / "models" / QWEN_FILE).exists()
    problems = []
    config = _read_json(config_path)
    if not isinstance(config, dict):
        problems.append("Course runtime-config.json is missing or invalid.")
        config = {}
    defaults = {"llamaExecutable": "runtime/llama/llama-server.exe", "llamaModel": "models/" + QWEN_FILE,
                "whisperModel": "models/whisper-small", "dependencies": "python-packages", "pythonExecutable": "runtime/python/python.exe"}
    resolved = {}
    for name, relative in defaults.items():
        value = config.get(name)
        if not isinstance(value, str) or not value or len(value) > 32760 or "\x00" in value:
            problems.append("Course setting " + name + " is missing or invalid.")
            resolved[name] = root / relative
            continue
        path = Path(value)
        path = path if path.is_absolute() else root / path
        if not _contained(path, root):
            problems.append("Course setting " + name + " points outside the local storage directory.")
            resolved[name] = root / relative
            continue
        resolved[name] = path
    _required(resolved["llamaExecutable"], "Local llama-server.exe", problems, root)
    _required(resolved["llamaModel"], "Qwen language model", problems, root)
    _required(resolved["pythonExecutable"], "Configured private Python", problems, root)
    if resolved["dependencies"].resolve() != packages.resolve():
        problems.append("The course dependency path does not match the private packages directory.")
    if _snapshot(resolved["whisperModel"], WHISPER_FILES, root) is None:
        problems.append("The local Whisper snapshot is incomplete (config, model, tokenizer or vocabulary is missing).")
    _packages(packages, _requirements("requirements.txt"), metadata, problems)
    return _component(detected, problems)


def _digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def _neural(root):
    directory = root / "neural"
    runtime = directory / "runtime"
    marker_path = directory / "installation.json"
    detected = marker_path.exists() or runtime.exists()
    if not detected:
        return _component(False, ["Local neural voices have not been installed."])
    problems = []
    marker = _read_json(marker_path)
    if (not isinstance(marker, dict) or marker.get("schemaVersion") != 1 or marker.get("engineVersion") != ENGINE_VERSION or
            not isinstance(marker.get("voices"), list) or len(marker["voices"]) != 2 or
            not all(isinstance(voice, str) for voice in marker["voices"]) or set(marker["voices"]) != {"female", "male"}):
        problems.append("The local voice installation marker is missing or invalid.")
    _required(runtime / "Windows-x64/run.exe", "Portable voice engine", problems, root)
    try:
        if (runtime / ".verified-archive-sha256").read_text(encoding="ascii").strip() != ENGINE_HASH:
            problems.append("The portable voice engine archive verification marker is invalid.")
    except (OSError, UnicodeError):
        problems.append("The portable voice engine archive verification marker is missing.")
    appdata = os.environ.get("APPDATA")
    if not appdata:
        problems.append("The current user's APPDATA voice model directory is unavailable.")
        return _component(detected, problems)
    shared = Path(appdata) / "AivisSpeech-Engine"
    model_directory = shared / "Models"
    # Marker-provided file names and hashes are deliberately ignored. Only the
    # shipped identities/checksums can satisfy a verified selected voice.
    for model in MODELS:
        candidates = [model_directory / (model["uuid"] + ".aivmx"), *[model_directory / name for name in model["aliases"]]]
        valid = False
        for path in candidates:
            try:
                if _contained(path, shared) and _file(path) and path.stat().st_size <= 300000000 and _digest(path) == model["hash"]:
                    valid = True
                    break
            except OSError:
                pass
        if not valid:
            problems.append(model["name"] + " model is missing or failed its published SHA256 check.")
    bert = shared / "BertModelCaches" / BERT_REPOSITORY
    if _snapshot(bert, BERT_FILES, shared) is None:
        problems.append("The shared Japanese BERT model/tokenizer snapshot is incomplete.")
    return _component(detected, problems)


def _legacy(root, packages, metadata):
    detected = (packages / "pyopenjtalk").exists() or "pyopenjtalk-plus" in metadata or (packages / ".word-voice-requirements-sha256").exists()
    problems = []
    _packages(packages, _requirements("word-voice-requirements.txt"), metadata, problems)
    for name in ("htsvoice/mei_normal.htsvoice", "dictionary/sys.dic", "dictionary/matrix.bin", "dictionary/char.bin", "dictionary/unk.dic"):
        _required(packages / "pyopenjtalk" / name, "Legacy word voice " + name, problems, root)
    return _component(detected, problems)


def _verify(result, expected, root):
    modules = [("numpy", "python"), ("av", "python")]
    if expected in {"course", "complete"}:
        modules.extend((name, "course") for name in ("ctranslate2", "faster_whisper", "huggingface_hub"))
    if expected in {"legacy", "complete"}:
        modules.append(("pyopenjtalk", "legacy"))
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            for name, component in modules:
                try:
                    module = importlib.import_module(name)
                    origin = getattr(module, "__file__", None)
                    if not isinstance(origin, str) or not _contained(Path(origin), root / "python-packages"):
                        raise ImportError("The library did not load from this installation's private packages")
                    if name == "pyopenjtalk" and str(getattr(module, "__version__", "")).replace("-post", ".post") != "0.4.1.post10":
                        raise ImportError("Unexpected legacy voice version")
                except Exception as error:
                    result[component]["problems"].append("Audio library " + name + " cannot be imported: " + (str(error)[:200] or type(error).__name__))
                    result[component]["installed"] = False
                    result[component]["state"] = "partial" if result[component]["detected"] else "missing"
    finally:
        sys.dont_write_bytecode = previous


def audit(cache_root, verify_audio=False, expected=None):
    root = Path(cache_root).resolve()
    packages = root / "python-packages"
    metadata = _metadata(packages)
    result = {"schemaVersion": SCHEMA_VERSION, "python": _python(root, packages, metadata),
              "course": _course(root, packages, metadata), "neural": _neural(root),
              "legacy": _legacy(root, packages, metadata)}
    if verify_audio:
        _verify(result, expected, root)
    return result


def satisfies(result, expected):
    return all(result[name]["installed"] for name in EXPECTATIONS.get(expected, ()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--expect", choices=tuple(EXPECTATIONS))
    parser.add_argument("--verify-audio", action="store_true")
    args = parser.parse_args()
    try:
        result = audit(args.cache_root, verify_audio=args.verify_audio, expected=args.expect)
    except Exception as error:
        # Still emit the same bounded JSON schema for a malformed/unreadable
        # installation; the installer must not parse a Python traceback.
        problem = "Installation audit failed: " + (str(error)[:300] or type(error).__name__)
        result = {"schemaVersion": SCHEMA_VERSION, **{name: _component(False, [problem]) for name in ("python", "course", "neural", "legacy")}}
    print(json.dumps(result, ensure_ascii=True, separators=(",", ":"), allow_nan=False))
    return 0 if args.expect is None or satisfies(result, args.expect) else 1


if __name__ == "__main__":
    raise SystemExit(main())
