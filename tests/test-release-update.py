"""Apply an actual signed release only to disposable earlier-package fixtures.

No native registration, browser profile, installed application or user models
are accessed. The pinned public key comes from the earlier public package.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import uuid

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / "helper"))
import updater


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot(path):
    return {file.relative_to(path).as_posix(): digest(file) for file in path.rglob("*") if file.is_file()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, required=True, help="Separate signed GitHub asset directory.")
    parser.add_argument("--old-package", type=Path, required=True, help="Published earlier unpacked package, read only.")
    parser.add_argument("--target-version", default="1.41.0")
    args = parser.parse_args()
    release, earlier = args.release.resolve(strict=True), args.old_package.resolve(strict=True)
    original = snapshot(earlier)
    raw = (release / "update-manifest.json").read_bytes()
    signature = (release / "update-manifest.sig").read_bytes()
    settings = updater.config(earlier)
    updater.verify_signature(raw, signature, settings["publicKeyXml"])
    old_version = updater.current_version(earlier)
    host = (earlier / "helper/native_host.py").read_text(encoding="utf-8")
    import re
    helper_version = re.search(r'^HOST_VERSION\s*=\s*[\'"]([^\'"]+)[\'"]', host, re.M).group(1)
    manifest = updater.validate_manifest(raw, settings, old_version, helper_version)
    assert manifest["version"] == args.target_version
    archive = release / manifest["asset"]["name"]
    assert archive.stat().st_size == manifest["asset"]["size"]
    assert digest(archive) == manifest["asset"]["sha256"]
    outcomes = []
    with tempfile.TemporaryDirectory(prefix="iknow-release-adoption-") as temporary:
        root = Path(temporary).resolve()
        for rollback in (False, True):
            case = root / ("rollback" if rollback else "success")
            app, cache = case / "Application", case / "LocalCache"
            assert app.resolve().is_relative_to(root) and cache.resolve().is_relative_to(root)
            shutil.copytree(earlier, app)
            cache.mkdir()
            (app / "personal-notes.txt").write_text("Keep local notes.", encoding="utf-8")
            sentinels = {
                cache / "models/existing-model.bin": b"Existing model fixture, never a real model.",
                cache / "packs/existing-course.json": b'{"saved":true}',
                cache / "neural/existing-word.wav": b"Cached word fixture.",
                case / "BrowserProfile/local-settings.json": b'{"library":"retained","theme":"midnight","volume":45}',
            }
            for file, payload in sentinels.items():
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(payload)
            before = snapshot(app)
            operation = uuid.uuid4().hex
            stage = updater.update_root(cache, app) / ("stage-" + operation)
            stage.mkdir(parents=True)
            (stage / "update-manifest.json").write_bytes(raw)
            (stage / "update-manifest.sig").write_bytes(signature)
            updater.atomic_json(stage / "transaction.json", {
                "schema": 1, "appRoot": str(app), "cacheRoot": str(cache), "operation": operation,
                "parentPid": 99999999, "helperVersion": helper_version,
                "publicKeyXml": settings["publicKeyXml"], "owner": settings["owner"], "repository": settings["repository"],
            })
            updater.extract_archive(archive, stage / "files", manifest)
            updater.validate_baseline(app, manifest)
            updater.validate_permissions(app, stage / "files")
            if rollback:
                try:
                    updater.transaction_apply(stage, fail_after=min(12, len(manifest["files"])-1))
                    raise AssertionError("The deliberate write failure did not occur.")
                except OSError as error:
                    assert "Injected" in str(error)
                assert snapshot(app) == before, "A failed adoption must restore every old file."
                assert updater.read_json(stage / "journal.json")["state"] == "rolled_back"
            else:
                result = updater.transaction_apply(stage)
                assert result["version"] == args.target_version
                for name, expected in manifest["files"].items():
                    assert digest(app / name) == expected, name
                assert (app / "personal-notes.txt").read_text(encoding="utf-8") == "Keep local notes."
                assert updater.current_version(app) == args.target_version
                assert updater.read_json(stage / "journal.json")["state"] == "complete"
                assert all((app / name).is_file() for name in (
                    "extension/study-focus.js", "extension/study-focus-kana.js",
                    "extension/study-workspace-data.js", "extension/audio-volume-controls.js",
                )), "The new Study assets must actually be installed."
            for file, payload in sentinels.items():
                assert file.read_bytes() == payload, "User data was changed: " + str(file.name)
            outcomes.append("rollback" if rollback else "installed")
    assert snapshot(earlier) == original, "The earlier published package is read only."
    print(json.dumps({"passed": True, "from": old_version, "to": args.target_version,
        "helperVersion": helper_version, "files": len(manifest["files"]), "signatureVerified": True,
        "outcomes": outcomes, "modelsCachesSettingsPreserved": True, "earlierPackageUnchanged": True}))


if __name__ == "__main__":
    main()
