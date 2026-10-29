"""Enable local publisher editing or export its reviewed draft to source.

This maintainer-only tool is not shipped in the application. No command signs,
commits, installs, pushes or publishes a release.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

SOURCE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SOURCE / "helper"))
import changelog_authoring as author


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("enable", "status", "export", "rebase"))
    parser.add_argument("--source", type=Path, default=SOURCE)
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
