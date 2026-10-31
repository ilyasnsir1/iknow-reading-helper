"""Generate the reviewed C1 Study UI for the extension, without installing it.

The preview remains the single UI source. Only the extension entry point and
asset paths differ; the controller uses study-workspace-data.js for real data.
This script never changes an installed application, manifest, model or cache.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "tools" / "preview"
ASSETS = (
    "study-layouts.css",
    "study-focus.js", "study-focus.css", "study-focus-course.js",
    "study-focus-audio.js", "study-focus-menus.js", "study-focus-menus.css",
    "study-focus-results.js", "study-focus-results.css",
    "study-focus-kana.js", "study-focus-kana.css",
    "study-focus-backup.js", "study-focus-backup.css", "study-focus-danger.css",
)
RUNTIME_ASSETS = ("study-workspace-data.js", "study-workspace-actions.js", "study-workspace-actions.css", "study-workspace-rounds.js", "audio-volume-controls.js", "audio-volume-controls.css")
BOOT_SCRIPT = """/* Extension-only early theme and runtime selection. */
(() => {
  'use strict';
  globalThis.IKnowStudyWorkspaceProduction = true;
  document.documentElement.dataset.studyRuntime = 'extension';
  try {
    const theme = localStorage.getItem('iknowReaderTheme');
    if (['paper','midnight','tokyo','forest'].includes(theme)) document.documentElement.dataset.ikrTheme = theme;
  } catch { /* The normal theme service also reads the extension preference. */ }
})();
"""


def replace_once(source: str, old: str, new: str) -> str:
    if source.count(old) != 1:
        raise ValueError(f"Expected one entry marker: {old}")
    return source.replace(old, new)


def entry_files() -> dict[str, str]:
    source = (SOURCE / "study-focus.html").read_text(encoding="utf-8")
    boot_style = re.findall(r'<style data-theme-boot-colors>\s*(.*?)\s*</style>', source, re.S)
    if len(boot_style) != 1:
        raise ValueError("Expected one early theme style in the reviewed page.")
    source, count = re.subn(r'^  <script data-theme-boot>.*?</script>\r?\n', '', source, flags=re.S | re.M)
    if count != 1:
        raise ValueError("Expected one preview theme bootstrap.")
    source, count = re.subn(r'^  <style data-theme-boot-colors>.*?</style>\r?\n', '', source, flags=re.S | re.M)
    if count != 1:
        raise ValueError("Expected one preview early theme style.")
    source = replace_once(source, '<html lang="en" data-ikr-theme="paper">',
                          '<html lang="en" class="ikr-theme-page" data-ikr-theme="paper" data-study-runtime="extension">')
    source = replace_once(source, '<link rel="stylesheet" href="/extension/theme.css">',
                          '<script src="study-workspace-boot.js"></script>\n'
                          '  <link rel="stylesheet" href="study-workspace-boot.css">\n'
                          '  <link rel="stylesheet" href="theme.css">\n'
                          '  <script src="theme.js"></script>')
    source = replace_once(source, '<script src="study-focus-course.js" defer></script>',
                          '<script src="study-workspace-data.js" defer></script>\n'
                          '  <script src="study-workspace-actions.js" defer></script>\n'
                          '  <script src="study-workspace-rounds.js" defer></script>\n'
                          '  <script src="study-focus-course.js" defer></script>')
    source = replace_once(source, '<link rel="stylesheet" href="study-focus-danger.css">',
                          '<link rel="stylesheet" href="study-focus-danger.css">\n'
                          '  <link rel="stylesheet" href="study-workspace-actions.css">')
    source = source.replace('/extension/', '')
    if re.search(r'<script\b(?![^>]*\bsrc=)', source, re.I):
        raise ValueError("The generated extension page must not contain inline scripts.")
    return {
        "study.html": source,
        "study-workspace-boot.js": BOOT_SCRIPT,
        "study-workspace-boot.css": "/* Initial page colors, generated from the reviewed Study page. */\n" + boot_style[0] + "\n",
    }


def stage(output: Path) -> dict[str, str]:
    files = entry_files()
    for name in ASSETS:
        # All extension dependencies live beside study.html, unlike the local
        # review server's /extension/ mount. No runtime or fixture data is copied.
        files[name] = (SOURCE / name).read_text(encoding="utf-8").replace('/extension/', '')
    output.mkdir(parents=True, exist_ok=True)
    inventory = {}
    payloads = {name: source.replace('\r\n', '\n').encode('utf-8') for name, source in files.items()}
    payloads.update({name: (ROOT / 'extension' / name).read_bytes() for name in RUNTIME_ASSETS})
    for name, payload in payloads.items():
        (output / name).write_bytes(payload)
        inventory[f"extension/{name}"] = hashlib.sha256(payload).hexdigest()
    return inventory


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'extension',
                        help='Canonical or isolated extension directory; never an installed application.')
    parser.add_argument('--inventory', type=Path, help='Write app-relative generated file hashes for local review/sync.')
    args = parser.parse_args()
    target = args.output.resolve()
    if target.name.lower() != 'extension':
        parser.error('--output must name an extension directory.')
    # The generator must not become a second, unchecked installation path.
    workspace = ROOT.parents[1]
    installed = (workspace / 'outputs' / 'iknow-lesehilfe').resolve()
    releases = (workspace / 'outputs' / 'releases').resolve()
    desktop = (Path.home() / 'Desktop' / 'iKnow Reading Helper').resolve()
    if any(target.is_relative_to(protected) for protected in (installed, releases, desktop)):
        parser.error('Generate into the canonical checkout or an isolated stage; use the reviewed sync transaction to install.')
    inventory = stage(target)
    result = {"files": inventory}
    if args.inventory:
        args.inventory.parent.mkdir(parents=True, exist_ok=True)
        args.inventory.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({"directory": str(target), "generatedFiles": len(inventory), **result}, indent=2))


if __name__ == '__main__':
    main()
