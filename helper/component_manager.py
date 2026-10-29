"""Explicit, resumable model installation from the release's trusted catalog.

Status is metadata-only. A detached worker verifies downloads and stages all
changes before activation; it never modifies the registered application. New
catalog entries arrive through the signed app updater, not browser messages.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from component_catalog import CATALOG_VERSION, COMPONENTS
from neural_speech import FileLock
from process_resources import ChildLifetime, creation_flags

HERE = Path(__file__).resolve().parent
ACTIVE = {"starting", "running", "pausing"}
MAX_STATE = 256_000


class ComponentError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


class Paused(InterruptedError):
    pass


def _read(path):
    try:
        if path.stat().st_size <= MAX_STATE:
            return json.loads(path.read_text(encoding="utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Invalid number")))
    except (OSError, UnicodeError, ValueError):
        pass
    return None


def _atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, ensure_ascii=False, allow_nan=False)
    if len(data.encode("utf-8")) > MAX_STATE:
        raise ValueError("Component checkpoint exceeds its limit.")
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_text(data, encoding="utf-8")
        for attempt in range(15):
            try:
                os.replace(temporary, path)
                return
            except PermissionError:
                if attempt == 14:
                    raise
                time.sleep(.02 * (attempt + 1))
    finally:
        temporary.unlink(missing_ok=True)


def _root(cache):
    root = Path(cache).resolve()
    if root == Path(root.anchor) or len(str(root)) < 10:
        raise ComponentError("component_cache", "The local component storage directory is invalid.")
    return root


def _directory(cache):
    root = _root(cache)
    result = root / "components"
    if not result.resolve().is_relative_to(root):
        raise ComponentError("component_storage", "The component storage path leaves its owned directory.")
    return result


def _item(component_id):
    if not isinstance(component_id, str) or component_id not in COMPONENTS:
        raise ComponentError("component_unknown", "Choose a component offered by this application version.")
    value = COMPONENTS[component_id]
    if value.get("id") != component_id or not re.fullmatch(r"[a-z][a-z0-9_-]{0,47}", component_id):
        raise ValueError("Invalid packaged component identity.")
    return value


def _relative(value):
    if not isinstance(value, str) or len(value) > 220 or "\\" in value or ":" in value:
        raise ValueError("Invalid packaged component path.")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("Invalid packaged component path.")
    return path


def _within(base, relative):
    base = Path(base).resolve()
    result = base.joinpath(*_relative(relative).parts)
    if not result.resolve().is_relative_to(base):
        raise ValueError("Component path leaves its owned storage directory.")
    return result


def _target(cache, artifact):
    if artifact.get("root", "cache") == "cache":
        base = _root(cache)
    elif artifact["root"] == "aivis" and os.environ.get("APPDATA"):
        base = Path(os.environ["APPDATA"]) / "AivisSpeech-Engine"
    else:
        raise ComponentError("component_storage", "The local voice model storage is unavailable.")
    return _within(base, artifact["target"])


def _artifact_valid(artifact):
    url = urllib.parse.urlsplit(artifact["url"])
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.port not in (None, 443):
        raise ValueError("Component download requires a packaged HTTPS address.")
    if not re.fullmatch(r"[a-f0-9]{64}", artifact["sha256"]):
        raise ValueError("Component download is missing its pinned SHA256.")
    maximum = artifact.get("maximum")
    if type(maximum) is not int or not 0 < maximum <= 12_000_000_000:
        raise ValueError("Invalid component download limit.")
    if artifact.get("size") is not None and not 0 < artifact["size"] <= maximum:
        raise ValueError("Invalid packaged component size.")
    _relative(artifact["target"])
    for legacy in artifact.get("legacy", []):
        _relative(legacy)


def _fingerprint(item):
    data = {key: item.get(key) for key in ("id", "version", "artifacts", "requirements")}
    if item.get("requirements"):
        name = item["requirements"]
        if name not in {"requirements.txt", "neural-voice-requirements.txt"}:
            raise ValueError("Unknown packaged dependency set.")
        data["requirementsSha256"] = hashlib.sha256((HERE / name).read_bytes()).hexdigest()
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def _files_present(cache, item):
    for artifact in item["artifacts"]:
        try:
            target = _target(cache, artifact)
            if artifact.get("archive"):
                executable = target / ("Windows-x64/run.exe" if artifact["archive"] == "7z" else "llama-server.exe")
                if not executable.is_file() or executable.stat().st_size == 0:
                    return False
            elif not target.is_file() or target.stat().st_size == 0:
                # Existing setup may have used the documented voice aliases.
                if item["id"] == "voices" and artifact["name"] in {"Mao Plain", "Nise"}:
                    alias = target.parent / ("mao.aivmx" if artifact["name"] == "Mao Plain" else "nise.aivmx")
                    if alias.is_file() and alias.stat().st_size > 0:
                        continue
                return False
            elif artifact.get("size") is not None and target.stat().st_size != artifact["size"]:
                return False
        except (OSError, ComponentError, ValueError):
            return False
    if item.get("requirements") and not _packages_present(cache, item):
        return False
    if item["id"] == "voices":
        installation = _read(cache / "neural/installation.json") or {}
        if installation.get("engineVersion") != "1.0.0" or installation.get("voices") != ["female", "male"]:
            return False
        shared = Path(os.environ.get("APPDATA", "__unavailable__")) / "AivisSpeech-Engine"
        bert = shared / "BertModelCaches/models--tsukumijima--deberta-v2-large-japanese-char-wwm-onnx"
        expected = ("model.onnx", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "vocab.txt")
        from setup_check import _snapshot
        if _snapshot(bert, expected, shared) is None:
            return False
    return True


def _packages_present(cache, item):
    record = (_read(_directory(cache) / "installed.json") or {}).get(item["id"], {})
    candidates = [cache / "python-packages"]
    if record.get("packages"):
        candidate = Path(record["packages"])
        if candidate.resolve().is_relative_to(cache.resolve()):
            candidates.insert(0, candidate)
    digest = hashlib.sha256((HERE / item["requirements"]).read_bytes()).hexdigest()
    candidates.insert(0, _directory(cache) / "packages" / digest)
    required = ("numpy/__init__.py", "av/__init__.py") + (("faster_whisper/__init__.py",) if item["requirements"] == "requirements.txt" else ())
    return any(all((folder / name).is_file() for name in required) for folder in candidates)


def active(cache):
    path = _directory(cache)
    if not path.is_dir():
        return False
    state = _read(path / "job.json") or {}
    if state.get("status") not in ACTIVE:
        return False
    probe = FileLock(path / "worker.lock")
    try:
        if not probe.acquire():
            return True
        # Give a just-launched detached process time to acquire its lock.
        timestamp = state.get("updatedAt", 0)
        return state.get("status") == "starting" and type(timestamp) in (int, float) and 0 <= time.time() - timestamp < 20
    finally:
        probe.release()


is_active = active


def snapshot(cache):
    root, directory = _root(cache), _directory(cache)
    installed = _read(directory / "installed.json") or {}
    job = _read(directory / "job.json")
    if isinstance(job, dict) and job.get("status") in ACTIVE and not active(root):
        job = {**job, "status": "paused", "code": "component_interrupted", "message": "Installation was interrupted. Resume to reuse completed downloads.", "updatedAt": time.time()}
        _atomic(directory / "job.json", job)
    components = []
    for component_id, item in COMPONENTS.items():
        _item(component_id)
        found = _files_present(root, item)
        record = installed.get(component_id, {})
        current = record.get("fingerprint") == _fingerprint(item)
        # Existing Setup.cmd installations remain usable. Cheap presence checks
        # do not claim a fresh checksum or inference test on every UI poll.
        status = "installed" if found and (current or not record) else "update_available" if found else "missing"
        components.append({key: item[key] for key in ("id", "title", "version", "description", "downloadBytes", "sizeIsEstimate") } | {
            "status": status, "installed": found, "verified": found and current,
            "verification": "verified_install" if found and current else "existing_install" if found else "not_installed"})
    return {"schemaVersion": 1, "catalogVersion": CATALOG_VERSION, "components": components,
            "job": job if isinstance(job, dict) else None, "active": active(root)}


def _checkpoint(cache, **patch):
    path = _directory(cache) / "job.json"
    value = _read(path) or {}
    value.update(patch, updatedAt=time.time())
    _atomic(path, value)
    return value


def _check_pause(cache):
    if (_directory(cache) / "pause").exists():
        raise Paused("Installation paused. Verified files and partial downloads are retained.")


def _digest(path, cache=None):
    result = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1024 * 1024):
            if cache is not None:
                _check_pause(cache)
            result.update(block)
    return result.hexdigest()


def download(cache, artifact, *, opener=urllib.request.urlopen):
    """Return a verified immutable download; old installed files stay untouched."""
    _artifact_valid(artifact)
    for name in artifact.get("legacy", []):
        legacy = _within(_root(cache), name)
        if legacy.is_file() and legacy.stat().st_size <= artifact["maximum"] and _digest(legacy, cache) == artifact["sha256"]:
            return legacy
    directory = _directory(cache) / "downloads"
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / artifact["sha256"]
    if not destination.resolve().is_relative_to(_root(cache)) or destination.is_symlink():
        raise ComponentError("component_storage", "The download storage path is linked outside its owned directory.")
    if destination.is_file() and _digest(destination, cache) == artifact["sha256"]:
        return destination
    partial = destination.with_suffix(".part")
    if not partial.resolve().is_relative_to(_root(cache)) or partial.is_symlink():
        raise ComponentError("component_storage", "The partial download storage path is linked outside its owned directory.")
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > artifact["maximum"]:
        partial.unlink(); offset = 0
    headers = {"User-Agent": "iKnow-Reading-Helper/component-manager"}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    _checkpoint(cache, phase="downloading", message="Downloading " + artifact["name"], downloadedBytes=offset,
                totalBytes=artifact.get("size"), progress=None, etaSeconds=None)
    request = urllib.request.Request(artifact["url"], headers=headers)
    try:
        response = opener(request, timeout=30)
    except urllib.error.HTTPError as error:
        if error.code == 416 and partial.is_file() and _digest(partial, cache) == artifact["sha256"]:
            partial.replace(destination); return destination
        raise
    with response:
        final_url = urllib.parse.urlsplit(response.geturl())
        if final_url.scheme != "https" or final_url.username or final_url.password:
            raise ComponentError("component_redirect", "The model host returned an unsafe redirect.")
        resumed = response.status == 206 and offset > 0
        if response.status not in (200, 206):
            raise ComponentError("component_response", "The model host did not return a usable download.")
        if resumed and not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
            raise ComponentError("component_range", "The resumed download range did not match. Retry this component.")
        count = offset if resumed else 0
        raw_length = response.headers.get("Content-Length")
        total = count + int(raw_length) if raw_length and raw_length.isdigit() else artifact.get("size")
        if total is not None and total > artifact["maximum"]:
            raise ComponentError("component_size", "The download exceeds this component's verified size limit.")
        last_report = 0.0
        started = time.monotonic()
        initial_count = count
        with partial.open("ab" if resumed else "wb") as output:
            while True:
                _check_pause(cache)
                block = response.read(256 * 1024)
                if not block:
                    break
                count += len(block)
                if count > artifact["maximum"]:
                    raise ComponentError("component_size", "The download exceeds this component's verified size limit.")
                output.write(block)
                if time.monotonic() - last_report >= .4:
                    elapsed = time.monotonic() - started
                    rate = (count - initial_count) / elapsed if elapsed > 0 else 0
                    _checkpoint(cache, downloadedBytes=count, totalBytes=total,
                                progress=count / total if total and count <= total else None,
                                etaSeconds=(total - count) / rate if total and rate > 0 and elapsed >= 1 else None)
                    last_report = time.monotonic()
        if total is not None and count != total:
            raise ComponentError("component_incomplete", "The model download was interrupted. Resume to keep its completed data.")
    _checkpoint(cache, phase="verifying", message="Verifying " + artifact["name"], progress=None, etaSeconds=None)
    if _digest(partial, cache) != artifact["sha256"]:
        partial.unlink(missing_ok=True)
        raise ComponentError("component_checksum", "The downloaded model failed its SHA256 check. Your installed version was retained.")
    partial.replace(destination)
    return destination


def extract_archive(cache, artifact, archive, destination):
    destination.mkdir(parents=True, exist_ok=False)
    if artifact["archive"] == "zip":
        with zipfile.ZipFile(archive) as bundle:
            entries = bundle.infolist()
            if len(entries) > 10_000 or sum(entry.file_size for entry in entries) > 2_000_000_000:
                raise ValueError("Runtime archive exceeds its unpacked limits.")
            for entry in entries:
                _check_pause(cache)
                target = _within(destination, entry.filename.rstrip("/"))
                if stat.S_ISLNK(entry.external_attr >> 16):
                    raise ValueError("Runtime archive contains a link.")
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.open(entry) as source, target.open("xb") as output:
                        shutil.copyfileobj(source, output, 1024 * 1024)
    elif artifact["archive"] == "7z":
        # Windows 11's bundled bsdtar supports this pinned 7z runtime. Inspect
        # both names and link types before extracting into an owned stage.
        plain = _command(cache, ["tar.exe", "-tf", str(archive)], capture=True)
        verbose = _command(cache, ["tar.exe", "-tvf", str(archive)], capture=True)
        for name in plain.splitlines():
            _within(destination, name.rstrip("/"))
        if any(line[:1] in {"l", "h"} or " -> " in line for line in verbose.splitlines()):
            raise ValueError("Runtime archive contains a link.")
        _command(cache, ["tar.exe", "-xf", str(archive), "-C", str(destination)])
        (destination / ".verified-archive-sha256").write_text(artifact["sha256"], encoding="ascii")
    else:
        raise ValueError("Unknown packaged runtime archive format.")
    executable = destination / ("Windows-x64/run.exe" if artifact["archive"] == "7z" else "llama-server.exe")
    if not executable.is_file() or executable.stat().st_size == 0:
        raise ValueError("The downloaded runtime is missing its expected executable.")
    return destination


def _command(cache, command, *, capture=False, timeout=1200):
    """Only packaged caller-built argument lists; never a shell or request text."""
    log = _directory(cache) / "install.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    if log.exists() and log.stat().st_size > 3_000_000:
        log.write_bytes(b"")
    with log.open("ab") as output:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE if capture else output, stderr=output,
                                 creationflags=creation_flags(), close_fds=True)
        lifetime = ChildLifetime(child)
        started = time.monotonic()
        try:
            if capture:
                # Archive listings are bounded by this known runtime's download
                # size. communicate drains its pipe while checking cancellation.
                while True:
                    _check_pause(cache)
                    try:
                        data, _ = child.communicate(timeout=.25)
                        break
                    except subprocess.TimeoutExpired:
                        if time.monotonic() - started > timeout:
                            raise TimeoutError("Component subprocess timed out.")
                if len(data) > 3_000_000:
                    raise ValueError("Runtime archive listing exceeds its limit.")
            else:
                while child.poll() is None:
                    _check_pause(cache)
                    if time.monotonic() - started > timeout:
                        raise TimeoutError("Component subprocess timed out.")
                    time.sleep(.2)
                data = b""
            if child.returncode:
                raise ComponentError("component_process", "A local installation step did not finish. Completed downloads are retained; retry this component.")
            return data.decode("utf-8", "replace")
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait(timeout=4)
            lifetime.close()


def _dependencies(cache, item):
    name = item.get("requirements")
    if not name:
        return None
    requirements = HERE / name
    digest = hashlib.sha256(requirements.read_bytes()).hexdigest()
    existing = _root(cache) / "python-packages"
    old_marker = existing / (".neural-voice-requirements-sha256" if name == "neural-voice-requirements.txt" else ".requirements-sha256")
    expected = ("numpy/__init__.py", "av/__init__.py") + (("faster_whisper/__init__.py",) if name == "requirements.txt" else ())
    if old_marker.is_file() and old_marker.read_text().strip().lower() == digest and all((existing / part).is_file() for part in expected):
        return existing
    destination = _directory(cache) / "packages" / digest
    marker = destination / ".component-requirements-sha256"
    if marker.is_file() and marker.read_text(encoding="ascii").strip() == digest:
        return destination
    temporary = destination.with_name(".stage-" + uuid.uuid4().hex[:16])
    temporary.mkdir(parents=True, exist_ok=False)
    _checkpoint(cache, phase="dependencies", message="Installing shared audio libraries", progress=None, downloadedBytes=None, totalBytes=None, etaSeconds=None)
    # New libraries have a separate immutable directory. Never run pip upgrade
    # over DLLs loaded by a current native host; failed dependency installs leave
    # its old working directory and Python search paths unchanged.
    _command(cache, [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:",
                     "--index-url", "https://pypi.org/simple", "--target", str(temporary), "--requirement", str(requirements)])
    (temporary / ".component-requirements-sha256").write_text(digest, encoding="ascii")
    if destination.exists():
        # A failed previous stage isn't activated. Keep it for diagnosis.
        destination.rename(destination.with_name(digest + ".previous-" + uuid.uuid4().hex))
    temporary.rename(destination)
    return destination


class Activation:
    """Durable same-volume replacements, recoverable after process shutdown."""
    def __init__(self, operation, cache):
        if not isinstance(operation, str) or not re.fullmatch(r"[a-f0-9]{32}", operation):
            raise ValueError("Invalid component transaction.")
        self.operation, self.cache, self.entries = operation, _root(cache), []
        self.path = _directory(cache) / "transactions" / (operation + ".json")

    def persist(self, status="activating"):
        _atomic(self.path, {"schemaVersion": 1, "operation": self.operation, "status": status, "entries": self.entries})

    def replace(self, staged, target):
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + ".component-new-" + self.operation)
        backup = target.with_name(target.name + ".component-old-" + self.operation)
        if target.is_symlink() or target.resolve() != target.absolute():
            raise ValueError("Component target is linked or outside its owned directory.")
        if target not in allowed_targets(self.cache):
            raise ValueError("The component cannot replace this storage path.")
        had_old = target.exists()
        self.entries.append({"target": str(target), "hadOld": had_old})
        self.persist()
        if staged.is_dir():
            shutil.copytree(staged, temporary)
        else:
            try:
                # Same-volume immutable weights need no second multi-GB copy.
                os.link(staged, temporary)
            except OSError:
                shutil.copyfile(staged, temporary)
        try:
            if had_old:
                target.rename(backup)
            temporary.rename(target)
        except Exception:
            if had_old and backup.exists() and not target.exists():
                backup.rename(target)
            raise

    def rollback(self):
        for entry in reversed(self.entries):
            target = Path(entry["target"])
            if target not in allowed_targets(self.cache) or type(entry.get("hadOld")) is not bool:
                raise ComponentError("component_recovery", "The interrupted component transaction needs manual inspection.")
            backup = target.with_name(target.name + ".component-old-" + self.operation)
            failed = target.with_name(target.name + ".component-failed-" + self.operation)
            temporary = target.with_name(target.name + ".component-new-" + self.operation)
            if temporary.exists():
                # Only the exact generated sibling of an allowed target can be
                # removed. Resolve/check it before any recursive operation.
                if temporary.is_symlink() or temporary.resolve().parent != target.parent.resolve():
                    raise ComponentError("component_recovery", "The temporary component path needs manual inspection.")
                if temporary.is_dir():
                    shutil.rmtree(temporary)
                else:
                    temporary.unlink()
            # If no backup exists, an old target was never moved (or this entry
            # has already been restored by an earlier recovery attempt).
            if entry["hadOld"] and not backup.exists():
                continue
            if target.exists() and not failed.exists():
                target.rename(failed)
            if entry["hadOld"] and backup.exists():
                backup.rename(target)
        self.persist("rolled_back")

    def finish(self):
        self.persist("committed")


def allowed_targets(cache):
    targets = {_target(cache, artifact) for item in COMPONENTS.values() for artifact in item["artifacts"]}
    targets.update(cache / name for name in ("runtime-config.json", "runtime/python/python312._pth", "neural/installation.json", "components/installed.json"))
    return targets


def recover_activations(cache):
    """Run with the same preparation locks before any explicit resumed install."""
    directory = _directory(cache) / "transactions"
    for path in directory.glob("*.json"):
        journal = _read(path)
        if not isinstance(journal, dict) or journal.get("status") != "activating":
            continue
        operation = path.stem
        if not re.fullmatch(r"[a-f0-9]{32}", operation) or journal.get("operation") != operation or not isinstance(journal.get("entries"), list) or len(journal["entries"]) > 100:
            raise ComponentError("component_recovery", "An interrupted component transaction needs manual inspection.")
        transaction = Activation(operation, cache)
        transaction.entries = journal["entries"]
        transaction.rollback()


def _cleanup_committed(cache, item, operation):
    """Only generated paths within verified owned directories are eligible."""
    for artifact in item["artifacts"]:
        # The verified active copy replaces the temporary download for plain
        # weights, avoiding a second permanent multi-gigabyte model copy.
        if not artifact.get("archive"):
            download_path = _directory(cache) / "downloads" / artifact["sha256"]
            if download_path.is_file() and not download_path.is_symlink() and download_path.resolve().is_relative_to(_directory(cache).resolve()):
                download_path.unlink()
    targets = allowed_targets(cache)
    for target in targets:
        owned_parent = target.parent.resolve()
        candidates = [path for path in target.parent.glob(target.name + ".component-old-*")
                      if re.fullmatch(re.escape(target.name) + r"\.component-old-[a-f0-9]{32}", path.name)
                      and not path.is_symlink() and path.resolve().parent == owned_parent]
        # Keep one previous version of every activated managed target.
        for path in sorted(candidates, key=lambda value: value.stat().st_mtime, reverse=True)[1:]:
            if path.is_dir():
                if not path.resolve().is_relative_to(owned_parent):
                    raise ValueError("Backup cleanup left its owned directory.")
                shutil.rmtree(path)
            else:
                path.unlink()
    stage_base = (_directory(cache) / "stages").resolve()
    stage = stage_base / operation
    if re.fullmatch(r"[a-f0-9]{32}", operation) and stage.is_dir() and not stage.is_symlink() and stage.resolve().parent == stage_base:
        shutil.rmtree(stage)


def _activate_config(cache, item, packages, stage, transaction):
    if item["id"] in {"language", "audio"}:
        value = _read(cache / "runtime-config.json") or {}
        defaults = {"llamaExecutable": str(cache / "runtime/llama/llama-server.exe"),
                    "llamaModel": str(cache / "models/Qwen3.5-9B-Q4_K_M.gguf"),
                    "whisperModel": str(cache / "models/whisper-small"),
                    "dependencies": str(cache / "python-packages"), "pythonExecutable": str(cache / "runtime/python/python.exe")}
        value = {**defaults, **value}
        if item["id"] == "language":
            value.update(llamaExecutable=defaults["llamaExecutable"], llamaModel=defaults["llamaModel"])
        else:
            value.update(whisperModel=defaults["whisperModel"], dependencies=str(packages))
        _atomic(stage / "runtime-config.json", value)
        transaction.replace(stage / "runtime-config.json", cache / "runtime-config.json")
    if packages:
        pth = cache / "runtime/python/python312._pth"
        if not pth.is_file():
            raise ComponentError("component_python", "The private Python runtime is missing. Run initial Setup.cmd once, then retry.")
        entries = pth.read_text(encoding="utf-8-sig").splitlines()
        relative = os.path.relpath(packages, pth.parent).replace("\\", "/")
        # Keep standard library and app-local entries first; use the current
        # component's libraries before older package fallbacks in future hosts.
        entries = [line for line in entries if line.strip() != relative]
        position = min(2, len(entries))
        entries.insert(position, relative)
        (stage / "python312._pth").write_text("\n".join(entries) + "\n", encoding="utf-8")
        transaction.replace(stage / "python312._pth", pth)


def _voice_maintenance(cache):
    path = cache / "neural/component-maintenance"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()
    # The supervisor observes this request and stops only its own child, after
    # synthesis/start locks have been acquired by the installation worker.
    owner = FileLock(cache / "neural/engine-owner.lock")
    deadline = time.monotonic() + 9
    while not owner.acquire():
        _check_pause(cache)
        if time.monotonic() > deadline:
            raise ComponentError("component_voice_busy", "The local voice is still closing. Retry when playback has finished.")
        time.sleep(.15)
    owner.release()
    import socket
    with socket.socket() as probe:
        probe.settimeout(.3)
        if probe.connect_ex(("127.0.0.1", 10103)) == 0:
            raise ComponentError("component_voice_busy", "Close the other local voice engine before updating voice components. No unrelated process was stopped.")


def install_component(cache, component_id, operation):
    root, item = _root(cache), _item(component_id)
    for artifact in item["artifacts"]:
        _artifact_valid(artifact)
    stage = _directory(root) / "stages" / operation
    stage.mkdir(parents=True, exist_ok=False)
    prepared = []
    for index, artifact in enumerate(item["artifacts"]):
        _check_pause(root)
        _checkpoint(root, fileIndex=index + 1, fileCount=len(item["artifacts"]), phase="checking", message="Checking " + artifact["name"], progress=None, downloadedBytes=None, totalBytes=None, etaSeconds=None)
        target = _target(root, artifact)
        # Explicit installs verify existing files once; status polling never
        # reads gigabytes of model data on the native/UI thread.
        candidates = [target]
        if component_id == "voices" and artifact["name"] in {"Mao Plain", "Nise"}:
            candidates.append(target.parent / ("mao.aivmx" if artifact["name"] == "Mao Plain" else "nise.aivmx"))
        if not artifact.get("archive") and any(path.is_file() and _digest(path, root) == artifact["sha256"] for path in candidates):
            continue
        if artifact.get("archive"):
            markers = [target / ".component-archive-sha256"] + ([target / ".verified-archive-sha256"] if artifact["archive"] == "7z" else [])
            executable = target / ("Windows-x64/run.exe" if artifact["archive"] == "7z" else "llama-server.exe")
            if executable.is_file() and any(marker.is_file() and marker.read_text().strip() == artifact["sha256"] for marker in markers):
                continue
        archive = download(root, artifact)
        if artifact.get("archive"):
            extracted = extract_archive(root, artifact, archive, stage / ("runtime-" + str(index)))
            (extracted / ".component-archive-sha256").write_text(artifact["sha256"], encoding="ascii")
            prepared.append((extracted, target))
        else:
            prepared.append((archive, target))
    packages = _dependencies(root, item)
    if packages:
        _checkpoint(root, phase="verifying", message="Checking the installed audio libraries", progress=None)
        _command(root, [sys.executable, str(HERE / "component_manager.py"), "_check-libraries", "--cache-root", str(root), "--packages", str(packages), "--component-id", item["id"]], timeout=120)
    _check_pause(root)
    _checkpoint(root, phase="activating", message="Activating verified component files", progress=None, downloadedBytes=None, totalBytes=None)
    transaction = Activation(operation, root)
    try:
        for staged, target in prepared:
            _check_pause(root)
            transaction.replace(staged, target)
        _activate_config(root, item, packages, stage, transaction)
        if component_id == "voices":
            import setup_neural_voice
            installation = {"schemaVersion": 1, "engineVersion": setup_neural_voice.ENGINE_VERSION,
                            "voices": ["female", "male"], "models": setup_neural_voice.MODELS, "installedAt": time.time()}
            _atomic(stage / "installation.json", installation)
            transaction.replace(stage / "installation.json", root / "neural/installation.json")
            _checkpoint(root, phase="resources", message="Preparing shared Japanese voice resources; first use can download additional files", progress=None)
            # It owns and reaps only the child started by this explicit setup.
            # A pause safely terminates that child through _command.
            _command(root, [sys.executable, str(HERE / "component_manager.py"), "_warm-voices", "--cache-root", str(root)], timeout=1000)
        _check_pause(root)
        installed = _read(_directory(root) / "installed.json") or {}
        installed[component_id] = {"version": item["version"], "fingerprint": _fingerprint(item), "installedAt": time.time(), "packages": str(packages) if packages else None}
        _atomic(stage / "installed.json", installed)
        transaction.replace(stage / "installed.json", _directory(root) / "installed.json")
        transaction.finish()
    except Exception:
        transaction.rollback()
        raise
    try:
        _cleanup_committed(root, item, operation)
    except OSError:
        # File locks/antivirus can delay cleanup; successful activation stands.
        pass


def worker(cache, operation):
    root, directory = _root(cache), _directory(cache)
    worker_lock, acquired = FileLock(directory / "worker.lock"), []
    if not worker_lock.acquire():
        return
    try:
        state = _read(directory / "job.json") or {}
        if state.get("jobId") != operation or state.get("status") != "starting":
            return
        _item(state.get("componentId"))
        import updater
        if updater.installing(root):
            raise ComponentError("component_update_busy", "Finish the application update before installing components.")
        try:
            acquired = updater.activity_locks(root)
        except updater.UpdateBusy:
            raise ComponentError("component_busy", "Pause course and word preparation and wait for playback before installing components.") from None
        _checkpoint(root, status="running", pid=os.getpid(), phase="starting", message="Starting component installation")
        recover_activations(root)
        if state["componentId"] == "voices":
            _voice_maintenance(root)
        install_component(root, state["componentId"], operation)
        _checkpoint(root, status="complete", phase="complete", message="Component installed. Existing course data is retained.", progress=1, code=None)
    except Paused:
        _checkpoint(root, status="paused", phase="paused", message="Installation paused. Resume to reuse verified files and partial downloads.", progress=None, code=None)
    except Exception as error:
        code = error.code if isinstance(error, ComponentError) else "component_network" if isinstance(error, (OSError, urllib.error.URLError)) else "component_install_failed"
        message = str(error) if isinstance(error, ComponentError) else "Installation could not finish. Completed downloads and the previous installed version are retained. Retry this component."
        _checkpoint(root, status="error", phase="error", message=message, code=code, progress=None)
    finally:
        (root / "neural/component-maintenance").unlink(missing_ok=True)
        for lock in reversed(acquired):
            lock.release()
        worker_lock.release()


def start(cache, message, busy=None):
    if message.get("manual") is not True:
        raise ComponentError("component_explicit", "Start component downloads explicitly from the component manager.")
    item = _item(message.get("componentId"))
    root, directory = _root(cache), _directory(cache)
    directory.mkdir(parents=True, exist_ok=True)
    launch = FileLock(directory / "launch.lock")
    if not launch.acquire():
        raise ComponentError("component_busy", "Another component installation is starting.")
    operation = None
    try:
        if active(root) or (busy() if callable(busy) else bool(busy)):
            raise ComponentError("component_busy", "Pause existing preparation before installing a component.")
        import updater
        if updater.installing(root):
            raise ComponentError("component_update_busy", "Finish the application update before installing components.")
        # Fail on active actual file locks before launching a worker as well.
        try:
            guards = updater.activity_locks(root)
        except updater.UpdateBusy:
            raise ComponentError("component_busy", "Pause preparation and wait for playback before installing components.") from None
        for guard in reversed(guards):
            guard.release()
        operation = uuid.uuid4().hex
        (directory / "pause").unlink(missing_ok=True)
        _atomic(directory / "job.json", {"schemaVersion": 1, "jobId": operation, "componentId": item["id"], "title": item["title"],
                 "version": item["version"], "status": "starting", "phase": "starting", "message": "Starting component installation…",
                 "progress": None, "downloadedBytes": None, "totalBytes": None, "updatedAt": time.time(), "createdAt": time.time()})
        log = directory / "worker.log"
        if log.exists() and log.stat().st_size > 3_000_000:
            log.write_bytes(b"")
        with log.open("ab") as output:
            subprocess.Popen([sys.executable, "-u", str(Path(__file__).resolve()), "_worker", "--cache-root", str(root), "--job-id", operation],
                             stdin=subprocess.DEVNULL, stdout=output, stderr=output, close_fds=True, creationflags=creation_flags(),
                             env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        return snapshot(root)
    except Exception:
        state = _read(directory / "job.json") or {}
        if operation and state.get("jobId") == operation and state.get("status") == "starting":
            _checkpoint(root, status="error", code="component_launch", message="The component worker could not start. Retry this component.")
        raise
    finally:
        launch.release()


def handle(message, cache, send, busy=None):
    request_id = message.get("requestId") if isinstance(message, dict) else None
    try:
        if not isinstance(message, dict) or set(message) - {"type", "requestId", "manual", "componentId"}:
            raise ComponentError("component_request", "Invalid component request.")
        action = str(message.get("type", "")).removeprefix("components:")
        if action == "status":
            value = snapshot(cache)
        elif action in {"start", "resume"}:
            value = start(cache, message, busy=busy)
        elif action == "pause" and message.get("manual") is True:
            if active(cache):
                (_directory(cache) / "pause").touch()
                _checkpoint(cache, status="pausing", message="Pausing after the current safe checkpoint…")
            value = snapshot(cache)
        else:
            raise ComponentError("component_request", "Choose an available component-manager action.")
        send({"type": "components:result", "requestId": request_id, "ok": True, "snapshot": value})
    except (ComponentError, ValueError, OSError) as error:
        send({"type": "components:result", "requestId": request_id, "ok": False,
              "code": getattr(error, "code", "component_request"),
              "message": str(error) if isinstance(error, ComponentError) else "The component request could not be completed."})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["_worker", "_warm-voices", "_check-libraries"])
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--job-id")
    parser.add_argument("--packages", type=Path)
    parser.add_argument("--component-id")
    args = parser.parse_args()
    if args.action == "_worker":
        if not isinstance(args.job_id, str) or not re.fullmatch(r"[a-f0-9]{32}", args.job_id):
            raise ValueError("Invalid component job ID.")
        worker(args.cache_root, args.job_id)
    elif args.action == "_check-libraries":
        if not args.packages or not args.packages.resolve().is_relative_to(_root(args.cache_root)):
            raise ValueError("The component library path is invalid.")
        sys.path.insert(0, str(args.packages.resolve()))
        import numpy, av
        if args.component_id == "audio":
            import faster_whisper, ctranslate2
        if numpy.__version__ != "2.5.4" or av.__version__ != "19.0.2":
            raise ImportError("The packaged audio library versions could not be verified.")
    else:
        import setup_neural_voice
        setup_neural_voice.warm_engine(_root(args.cache_root), _root(args.cache_root) / "neural/runtime/Windows-x64/run.exe")
