"""Local maintainer drafts. Never edits installed files or publishes anything.

The authoring capability requires explicit per-user configuration and the
publisher's matching private key, both outside the application package. Native
requests cannot supply paths, a role, a key or an alternative publisher root.
"""
from __future__ import annotations

import base64
import binascii
import contextlib
from datetime import date
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import struct
import tempfile
import threading
import time
import xml.etree.ElementTree as ET

MAX_DRAFT = 512 * 1024
MAX_IMAGE = 600 * 1024
MAX_ASSETS = 100
MAX_ASSET_BYTES = 20 * 1024 * 1024
IMAGE = re.compile(r"changelog-media/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|webp|jpg|jpeg)\Z")
OWN_IMAGE = re.compile(r"changelog-media/author-[a-f0-9]{32}\.(?:png|webp|jpg)\Z")
ID = re.compile(r"[a-z0-9][a-z0-9-]{0,79}\Z")
VERSION = re.compile(r"\d+\.\d+\.\d+(?:\.\d+)?\Z")
LOCAL = Path(os.environ.get("LOCALAPPDATA", str(Path.home())))
PUBLISHER_ROOT = LOCAL / "iKnowReadingHelperPublisher"
_mutex = threading.Lock()


class AuthorError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _fail(code="invalid_changelog", message="Check the changelog fields and try again."):
    raise AuthorError(code, message)


def _text(value, limit, required=False):
    if not isinstance(value, str) or len(value) > limit or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", value) or required and not value.strip():
        _fail()
    return value


def _array(value, maximum, required=False):
    if not isinstance(value, list) or len(value) > maximum or required and not value:
        _fail()
    return value


def validate(value):
    if not isinstance(value, dict) or type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1:
        _fail()
    entries, ids = [], set()
    for entry in _array(value.get("entries"), 100):
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not ID.fullmatch(entry["id"]) or entry["id"] in ids:
            _fail()
        ids.add(entry["id"])
        version, day, status = entry.get("version"), entry.get("date"), entry.get("status")
        if status not in ("released", "unreleased") or version is not None and (not isinstance(version, str) or not VERSION.fullmatch(version)):
            _fail()
        if day is not None:
            try:
                if not isinstance(day, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) or date.fromisoformat(day).isoformat() != day:
                    _fail()
            except ValueError:
                _fail()
        if status == "released" and (version is None or day is None):
            _fail()
        changes = []
        for change in _array(entry.get("changes"), 20, True):
            if not isinstance(change, dict) or change.get("type") not in ("fixed", "added", "improved"):
                _fail()
            images = []
            for image in _array(change.get("images", []), 5):
                if not isinstance(image, dict) or not isinstance(image.get("src"), str) or len(image["src"]) > 200 or not IMAGE.fullmatch(image["src"]) or ".." in image["src"]:
                    _fail()
                images.append({"src": image["src"], "alt": _text(image.get("alt"), 500, True), "caption": _text(image.get("caption", ""), 1000)})
            changes.append({"type": change["type"], "title": _text(change.get("title"), 160, True),
                            "description": _text(change.get("description"), 2000, True),
                            "details": [_text(item, 2000, True) for item in _array(change.get("details", []), 10)], "images": images})
        entries.append({"id": entry["id"], "version": version, "status": status, "date": day,
                        "title": _text(entry.get("title"), 160, True), "summary": _text(entry.get("summary", ""), 2000), "changes": changes})
    result = {"schemaVersion": 1, "entries": entries}
    if len(_encode(result)) > MAX_DRAFT:
        _fail("draft_too_large", "This changelog is too large. Shorten an entry or remove an image reference.")
    return result


def _encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def _safe(path, root):
    """Reject links/junctions at every existing component, even inside the root."""
    root, path = Path(root).absolute(), Path(path).absolute()
    try:
        path.relative_to(root)
    except ValueError:
        _fail("authoring_path", "The local draft location is not available.")
    for component in (root, *path.relative_to(root).parts):
        if component == root:
            current = root
        else:
            current = current / component
        if current.is_symlink() or getattr(current, "is_junction", lambda: False)():
            _fail("authoring_path", "Linked draft locations are not supported.")
    return path


def _read(path, limit):
    if path.stat().st_size > limit:
        _fail("authoring_file", "A local draft file is too large.")
    return path.read_bytes()


def _json(path, limit):
    return json.loads(_read(path, limit), parse_constant=lambda _: _fail())


def _key_matches(private, public):
    """Check RSA consistency without signing, subprocesses or exporting secrets."""
    try:
        if b"<!" in private or "<!" in public:
            return False
        key, pinned = ET.fromstring(private), ET.fromstring(public)
        if key.tag != "RSAKeyValue" or pinned.tag != "RSAKeyValue":
            return False
        names = ("Modulus", "Exponent", "D", "P", "Q", "DP", "DQ", "InverseQ")
        values = {}
        for name in names:
            raw = base64.b64decode(key.findtext(name, ""), validate=True)
            if not raw or len(raw) > 1024:
                return False
            values[name] = int.from_bytes(raw, "big")
        for name in ("Modulus", "Exponent"):
            if base64.b64decode(pinned.findtext(name, ""), validate=True) != base64.b64decode(key.findtext(name, ""), validate=True):
                return False
        n, e, d, p, q = (values[name] for name in ("Modulus", "Exponent", "D", "P", "Q"))
        return n.bit_length() >= 2048 and p > 2 and q > 2 and p * q == n and e >= 3 and (e * d) % math.lcm(p - 1, q - 1) == 1 and values["DP"] == d % (p - 1) and values["DQ"] == d % (q - 1) and (q * values["InverseQ"]) % p == 1
    except (ValueError, TypeError, ET.ParseError, binascii.Error):
        return False


def authorized(app_root, publisher_root=None):
    root = Path(publisher_root) if publisher_root is not None else PUBLISHER_ROOT
    try:
        config = _json(_safe(root / "changelog-authoring.json", root), 8192)
        settings = _json(Path(app_root) / "helper/update-config.json", 32768)
        public = settings.get("publicKeyXml")
        if not isinstance(public, str) or type(config.get("schemaVersion")) is not int or config["schemaVersion"] != 1 or config.get("enabled") is not True or config.get("publisherKeySha256") != hashlib.sha256(public.encode()).hexdigest():
            return False
        key = _read(_safe(root / "signing-key.xml", root), 32768)
        return _key_matches(key, public)
    except (OSError, ValueError, TypeError, AttributeError):
        return False


@contextlib.contextmanager
def _lock(root):
    with _mutex:
        root.mkdir(parents=True, exist_ok=True)
        path = _safe(root / "draft.lock", root)
        with path.open("a+b") as stream:
            stream.seek(0); stream.write(b"0"); stream.flush()
            deadline = time.monotonic() + 3
            acquired = False
            while not acquired:
                try:
                    if os.name == "nt":
                        import msvcrt
                        stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    acquired = True
                except OSError:
                    if time.monotonic() >= deadline:
                        _fail("draft_busy", "The draft is busy in another window. Try again.")
                    time.sleep(.03)
            try:
                yield
            finally:
                if os.name == "nt":
                    import msvcrt
                    stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream, fcntl.LOCK_UN)


def _atomic(path, data, root):
    _safe(path, root)
    fd, temporary = tempfile.mkstemp(prefix=".draft-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            Path(temporary).unlink()


def _image_data(raw, mime):
    if not raw or len(raw) > MAX_IMAGE:
        _fail("image_size", "Choose an image smaller than 600 KB.")
    if mime == "image/png" and raw.startswith(b"\x89PNG\r\n\x1a\n") and len(raw) >= 33 and raw[12:16] == b"IHDR":
        width, height = struct.unpack(">II", raw[16:24]); extension = "png"
    elif mime == "image/webp" and len(raw) >= 30 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" and int.from_bytes(raw[4:8], "little") + 8 == len(raw):
        extension = "webp"
        if raw[12:16] == b"VP8X":
            width, height = int.from_bytes(raw[24:27], "little") + 1, int.from_bytes(raw[27:30], "little") + 1
        elif raw[12:16] == b"VP8L" and raw[20] == 0x2f:
            bits = int.from_bytes(raw[21:25], "little")
            width, height = (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1
        elif raw[12:16] == b"VP8 " and raw[23:26] == b"\x9d\x01\x2a":
            width, height = int.from_bytes(raw[26:28], "little") & 0x3fff, int.from_bytes(raw[28:30], "little") & 0x3fff
        else:
            _fail("image_type", "This WebP image could not be read.")
    elif mime == "image/jpeg" and len(raw) >= 4 and raw.startswith(b"\xff\xd8\xff") and raw.endswith(b"\xff\xd9"):
        extension, offset, width, height = "jpg", 2, 0, 0
        while offset + 4 <= len(raw):
            if raw[offset] != 0xff:
                break
            while offset < len(raw) and raw[offset] == 0xff:
                offset += 1
            if offset + 3 > len(raw):
                break
            marker = raw[offset]; offset += 1
            if marker in (0xd9, 0xda):
                break
            if marker == 0x01 or 0xd0 <= marker <= 0xd7:
                continue
            length = int.from_bytes(raw[offset:offset + 2], "big")
            if length < 2 or offset + length > len(raw):
                break
            if marker in (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf) and length >= 7:
                height, width = struct.unpack(">HH", raw[offset + 3:offset + 7]); break
            offset += length
    else:
        _fail("image_type", "Choose a PNG, JPEG or WebP image.")
    if width < 1 or height < 1 or width > 16000 or height > 16000 or width * height > 40_000_000:
        _fail("image_dimensions", "Choose a smaller image.")
    return extension


def _source(app_root):
    raw = _read(Path(app_root) / "extension/changelog.json", MAX_DRAFT)
    return validate(json.loads(raw, parse_constant=lambda _: _fail())), hashlib.sha256(raw).hexdigest()


def _state(root, app_root):
    published, source_hash = _source(app_root)
    path = _safe(root / "draft.json", root)
    if path.exists():
        state = _json(path, MAX_DRAFT + 65536)
        if not isinstance(state, dict) or type(state.get("revision")) is not int or state["revision"] < 0:
            _fail("draft_invalid", "The saved draft could not be read.")
        draft = validate(state.get("draft"))
        baseline = state.get("baseSourceHash")
        if baseline is not None and (not isinstance(baseline, str) or not re.fullmatch(r"[a-f0-9]{64}", baseline)):
            _fail("draft_invalid", "The saved draft baseline could not be read.")
        # Previously exported notes may now be the installed/current release.
        # Equal content needs no rebase. Older drafts without a baseline are
        # conservative: a differing source must be reviewed before exporting.
        if draft == published:
            baseline = source_hash
        return {"revision": state["revision"], "draft": draft, "baseSourceHash": baseline,
                "sourceHash": source_hash, "sourceChanged": baseline != source_hash}
    return {"revision": 0, "draft": published, "baseSourceHash": source_hash,
            "sourceHash": source_hash, "sourceChanged": False}


def _store_state(root, state):
    _atomic(root / "draft.json", _encode({key: state[key] for key in ("revision", "draft", "baseSourceHash")}), root)


def _assets(root):
    path = _safe(root / "images.json", root)
    if not path.exists():
        return {}
    value = _json(path, 65536)
    if not isinstance(value, dict) or len(value) > MAX_ASSETS:
        _fail("draft_invalid", "The saved image list could not be read.")
    clean = {}
    for src, image in value.items():
        if not OWN_IMAGE.fullmatch(src) or not isinstance(image, dict) or image.get("mime") not in ("image/png", "image/jpeg", "image/webp") or type(image.get("size")) is not int or not 0 < image["size"] <= MAX_IMAGE:
            _fail("draft_invalid", "The saved image list could not be read.")
        clean[src] = {"mime": image["mime"], "size": image["size"]}
    return clean


def _references(draft):
    return {image["src"] for entry in draft["entries"] for change in entry["changes"] for image in change["images"]}


def _snapshot(state, assets):
    return {"draft": state["draft"], "revision": state["revision"], "sourceChanged": state["sourceChanged"],
            "sourceHash": state["sourceHash"], "images": [{"src": src, **value} for src, value in assets.items()]}


def rebase(app_root, *, publisher_root=None, expected_revision=None):
    """Explicit publisher-tool operation only; never callable through IPC."""
    if not authorized(app_root, publisher_root):
        _fail("authoring_forbidden", "Enable maintainer editing on the publisher's PC first.")
    publisher = Path(publisher_root) if publisher_root is not None else PUBLISHER_ROOT
    root = _safe(publisher / "changelog", publisher)
    with _lock(root):
        state, assets = _state(root, app_root), _assets(root)
        if expected_revision is not None and expected_revision != state["revision"]:
            _fail("draft_conflict", "The draft changed. Review it again before rebasing.")
        published, source_hash = _source(app_root)
        ids = {entry["id"] for entry in state["draft"]["entries"]}
        # The caller explicitly chose to keep reviewed draft edits for matching
        # IDs. Newly published IDs are retained rather than silently discarded.
        state["draft"] = validate({"schemaVersion": 1, "entries": state["draft"]["entries"] + [entry for entry in published["entries"] if entry["id"] not in ids]})
        state.update(baseSourceHash=source_hash, sourceHash=source_hash, sourceChanged=False, revision=state["revision"] + 1)
        _store_state(root, state)
        return {"ok": True, **_snapshot(state, assets)}


def execute(message, app_root, *, publisher_root=None):
    """Trusted Python callers may override roots for isolated tests; IPC may not."""
    if not isinstance(message, dict):
        _fail()
    action = message.get("action")
    available = authorized(app_root, publisher_root)
    if action == "status":
        return {"ok": True, "available": available, "role": "maintainer" if available else "reader"}
    if not available:
        _fail("authoring_forbidden", "Editing is available only on the maintainer's configured PC.")
    if action not in ("load", "save", "image:add", "image:remove", "image:get"):
        _fail("authoring_action", "This editing action is not supported.")
    publisher = Path(publisher_root) if publisher_root is not None else PUBLISHER_ROOT
    root = _safe(publisher / "changelog", publisher)
    with _lock(root):
        state, assets = _state(root, app_root), _assets(root)
        if action == "load":
            return {"ok": True, **_snapshot(state, assets)}
        if action == "image:get":
            src = message.get("src")
            if not isinstance(src, str) or not OWN_IMAGE.fullmatch(src) or src not in assets:
                _fail("image_missing", "This draft image is not available.")
            raw = _read(_safe(root / "images" / src.split("/")[1], root), MAX_IMAGE)
            _image_data(raw, assets[src]["mime"])
            return {"ok": True, "image": {"src": src, "mime": assets[src]["mime"], "base64": base64.b64encode(raw).decode("ascii")}}
        if type(message.get("expectedRevision")) is not int or message["expectedRevision"] != state["revision"]:
            _fail("draft_conflict", "This draft changed in another window. Reload it before saving.")
        result = {}
        if action == "save":
            draft = validate(message.get("draft"))
            for src in _references(draft):
                if src in assets:
                    if not _safe(root / "images" / src.split("/")[1], root).is_file():
                        _fail("image_missing", "A draft image is missing. Add it again before saving.")
                elif not _safe(Path(app_root) / "extension" / src, Path(app_root)).is_file():
                    _fail("image_missing", "A changelog image is not part of this installation.")
            state["draft"] = draft
        elif action == "image:add":
            if not isinstance(message.get("fileName"), str) or not re.fullmatch(r"[^\\/\x00-\x1f]{1,150}", message["fileName"]):
                _fail("image_name", "Choose a valid image file.")
            encoded = message.get("base64")
            if not isinstance(encoded, str) or len(encoded) > (MAX_IMAGE + 2) // 3 * 4:
                _fail("image_size", "Choose an image smaller than 600 KB.")
            try:
                raw = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error):
                _fail("image_type", "This image could not be read.")
            extension = _image_data(raw, message.get("mime"))
            if len(assets) >= MAX_ASSETS or sum(item["size"] for item in assets.values()) + len(raw) > MAX_ASSET_BYTES:
                _fail("image_limit", "Remove an unused draft image before adding another.")
            src = f"changelog-media/author-{secrets.token_hex(16)}.{extension}"
            directory = _safe(root / "images", root); directory.mkdir(exist_ok=True)
            _atomic(directory / src.split("/")[1], raw, root)
            assets[src] = {"mime": message["mime"], "size": len(raw)}
            _atomic(root / "images.json", _encode(assets), root)
            result["image"] = {"src": src, "alt": message["fileName"].rsplit(".", 1)[0].strip()[:500] or "Changelog image"}
        else:
            src = message.get("src")
            if not isinstance(src, str) or not OWN_IMAGE.fullmatch(src) or src not in assets:
                _fail("image_missing", "Only a local draft upload can be removed here.")
            if src in _references(state["draft"]):
                _fail("image_in_use", "Remove this image from its changelog entry and save first.")
            _safe(root / "images" / src.split("/")[1], root).unlink(missing_ok=True)
            del assets[src]
            _atomic(root / "images.json", _encode(assets), root)
        state["revision"] += 1
        published, source_hash = _source(app_root)
        if state["draft"] == published:
            state["baseSourceHash"] = source_hash
        state.update(sourceHash=source_hash, sourceChanged=state["baseSourceHash"] != source_hash)
        _store_state(root, state)
        return {"ok": True, **_snapshot(state, assets), **result}


def handle(message, app_root, send):
    response = {"type": "changelog:author:result", "requestId": message.get("requestId")}
    try:
        response.update(execute(message, app_root))
    except AuthorError as error:
        response.update(ok=False, code=error.code, error=str(error))
    except (OSError, ValueError, TypeError, KeyError):
        response.update(ok=False, code="authoring_unavailable", error="The local draft could not be opened. Its existing files were kept.")
    send(response)
