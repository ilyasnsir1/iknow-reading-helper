"""Enable local publisher editing or export its reviewed draft to source.

This maintainer-only tool is not shipped in the application. No command signs,
commits, installs, pushes or publishes a release.
"""
from __future__ import annotations

import argparse
import copy
from datetime import date
import hashlib
import json
from pathlib import Path
import shutil
import sys

SOURCE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SOURCE / "helper"))
import changelog_authoring as author


def release_view(draft, version, release_date):
    """Project the intended publication display without finalizing its draft."""
    if not isinstance(version, str) or not author.VERSION.fullmatch(version):
        raise ValueError("Choose a valid release display version.")
    if not isinstance(release_date, str) or date.fromisoformat(release_date).isoformat() != release_date:
        raise ValueError("Choose a valid release display date.")
    result = copy.deepcopy(draft)
    pending = [entry for entry in result["entries"] if entry["status"] == "unreleased"]
    if len(pending) != 1:
        raise ValueError("Review exactly one forthcoming entry before showing the release view.")
    order = lambda value: tuple(int(part) for part in value.split(".")) + (0,) * (4-len(value.split(".")))
    if any(entry["version"] and order(entry["version"]) >= order(version) for entry in result["entries"] if entry["status"] == "released"):
        raise ValueError("The display version must be newer than the public history.")
    pending[0].update(version=version,date=release_date,status="released")
    return author.validate(result)


def preview_draft(source, output, snapshot, *, display_version=None, display_date=None):
    """Render the private draft in a separate, read-only local preview folder."""
    output = output.absolute()
    if any(path.is_symlink() or getattr(path, "is_junction", lambda: False)() for path in (output, *output.parents)):
        raise ValueError("The preview output must not use linked folders.")
    output = output.resolve()
    workspace = source.parents[1]
    protected = (source, workspace / "outputs", author.PUBLISHER_ROOT, Path.home() / "Desktop/iKnow Reading Helper")
    if any(output == root or output.is_relative_to(root) or root.is_relative_to(output) for root in protected):
        raise ValueError("Use a separate preview folder outside source, installed applications and publisher files.")
    output.mkdir(parents=True, exist_ok=True)
    for name in ("changelog.css", "changelog.js", "changelog-editor.css", "theme.css", "theme.js", "icons/icon128.png"):
        target = author._safe(output / name, output)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / "extension" / name, target)
    data = release_view(snapshot["draft"], display_version, display_date) if display_version else snapshot["draft"]
    page = (source / "extension/changelog.html").read_text(encoding="utf-8")
    if display_version:
        page=page.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="ikr-changelog-display-version" content="'+display_version+'">')
    page = page.replace('<script src="theme.js"></script>', '<script src="changelog-preview-storage.js"></script>\n  <script src="theme.js"></script>')
    # The preview uses the real reader. Native diagnostics and owner editing
    # remain exclusive to the installed extension, with its authorization.
    page = page.replace('  <script src="diagnostic-page-errors.js" defer></script>\n', '')
    page = page.replace('  <script src="changelog-editor.js" defer></script>\n', '')
    page = page.replace('href="study.html"', 'href="/study-focus.html#study"')
    author._atomic(output / "changelog.html", page.encode("utf-8"), output)
    author._atomic(output / "changelog.json", author._encode(data), output)
    shutil.copyfile(source / "tools/changelog/preview-theme-storage.js", author._safe(output / "changelog-preview-storage.js", output))
    private_images = {image["src"]: image for image in snapshot["images"]}
    for name in sorted(author._references(snapshot["draft"])):
        if name in private_images:
            original = author._safe(author.PUBLISHER_ROOT / "changelog/images" / name.split("/")[1], author.PUBLISHER_ROOT)
            raw = author._read(original, author.MAX_IMAGE)
            author._image_data(raw, private_images[name]["mime"])
        else:
            raw = author._read(author._safe(source / "extension" / name, source), author.MAX_IMAGE)
        target = author._safe(output / name, output)
        target.parent.mkdir(parents=True, exist_ok=True)
        author._atomic(target, raw, output)
    print("Local changelog view: " + str(output / "changelog.html"))
    print("The private draft, installed application and published changelog were not changed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("enable", "status", "export", "rebase", "preview"))
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, help="Separate read-only draft preview folder; only for preview.")
    parser.add_argument("--display-version", help="Show the final publication layout locally, without finalizing the draft.")
    parser.add_argument("--display-date", help="Intended date in the local final layout, YYYY-MM-DD.")
    parser.add_argument("--reviewed", action="store_true", help="Confirm the draft/source differences have been reviewed before rebasing.")
    args = parser.parse_args()
    source, publisher = args.source.resolve(strict=True), author.PUBLISHER_ROOT
    config = json.loads((source / "helper/update-config.json").read_bytes())
    if args.action == "enable":
        # The existing private key's protected per-user directory is reused;
        # this command must never create or replace a publisher key.
        private = author._read(author._safe(publisher / "signing-key.xml", publisher), 32768)
        if not author._key_matches(private, config["publicKeyXml"]):
            raise ValueError("This PC does not have the project's matching publisher key.")
        value = {"schemaVersion": 1, "enabled": True, "publisherKeySha256": hashlib.sha256(config["publicKeyXml"].encode()).hexdigest()}
        author._atomic(publisher / "changelog-authoring.json", author._encode(value), publisher)
        print("Local maintainer editing enabled. No release or installed application was changed.")
    elif args.action == "status":
        print("Maintainer editing is enabled." if author.authorized(source) else "Read-only: no matching local maintainer configuration.")
    else:
        if not author.authorized(source):
            raise ValueError("Enable maintainer editing on the publisher's PC first.")
        # An exact local Git checkout is required so files cannot be exported
        # over an installed application folder by a browser-supplied path.
        if not (source / ".git").exists() or not (source / "tools/publisher/stage-package.py").is_file():
            raise ValueError("Export only to the maintainer's source checkout.")
        snapshot = author.execute({"action": "load"}, source)
        if args.action == "preview":
            if not args.output:
                parser.error("preview requires --output.")
            if snapshot["sourceChanged"]:
                raise ValueError("Review and rebase the draft before previewing newer source history.")
            if bool(args.display_version) != bool(args.display_date):
                parser.error("Use --display-version and --display-date together.")
            preview_draft(source, args.output, snapshot, display_version=args.display_version, display_date=args.display_date)
            return
        if args.action == "rebase":
            if not args.reviewed:
                raise ValueError("Review the source and draft first, then use rebase --reviewed. Matching IDs keep draft edits; new published IDs are retained.")
            author.rebase(source, expected_revision=snapshot["revision"])
            print("Reviewed draft rebased onto current source. New entries were retained; matching IDs keep draft edits. Nothing was published.")
            return
        if snapshot["sourceChanged"]:
            raise ValueError("The published/source changelog changed after this draft was saved. Review both versions, then explicitly rebase before exporting.")
        draft = snapshot["draft"]
        media = source / "extension/changelog-media"
        media.mkdir(exist_ok=True)
        for src in sorted(author._references(draft)):
            if src in {image["src"] for image in snapshot["images"]}:
                original = author._safe(publisher / "changelog/images" / src.split("/")[1], publisher)
                target = author._safe(source / "extension" / src, source)
                raw = author._read(original, author.MAX_IMAGE)
                asset = next(item for item in snapshot["images"] if item["src"] == src)
                author._image_data(raw, asset["mime"])
                author._atomic(target, raw, source)
        if author._source(source)[1] != snapshot["sourceHash"]:
            raise ValueError("The source changed during export. Review it before retrying.")
        author._atomic(source / "extension/changelog.json", author._encode(draft), source)
        print("Draft exported to source. Review it and publish only after explicit approval.")


if __name__ == "__main__":
    main()
