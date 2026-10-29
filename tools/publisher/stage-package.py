"""Stage only managed application files from the source checkout for a release."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil

DOCS = ('README.md', 'START-HERE.md', 'SHARE-WITH-A-FRIEND.md', 'VOICE-OPTIONS.md',
        'RECORDING-A-FRESH-INSTALL.md', 'MEANING-NOTES.md', 'ALIGNMENT-MODES.md',
        'DIAGNOSTICS.md', 'DOWNLOADS-AND-RECOVERY.md', 'UPDATES.md', 'MODELS-AND-VOICES.md', 'STUDY.md', 'THEMES.md', 'CHANGELOG.md', '.gitignore')


def stage(source, output):
    source, output = source.resolve(strict=True), output.resolve()
    if source == output or source.is_relative_to(output) or output.is_relative_to(source):
        raise ValueError('Use a separate release directory outside the source checkout.')
    # New output prevents stale files from silently entering an otherwise clean
    # release. Old releases remain usable for comparison and rollback.
    output.mkdir(parents=True, exist_ok=False)
    for name in ('extension', 'helper'):
        shutil.copytree(source / name, output / name,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.pyo', *(['*.md'] if name == 'extension' else [])))
    for name in DOCS:
        if (source / name).is_file():
            shutil.copy2(source / name, output / name)
    version = json.loads((output / 'extension/manifest.json').read_bytes())['version']
    files = {file.relative_to(output).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest()
             for file in sorted(output.rglob('*')) if file.is_file()}
    (output / 'RELEASE-FILES.json').write_bytes((json.dumps({'version': version, 'sha256': files}, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(f'Staged {len(files) + 1} managed files for version {version}.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    stage(args.source, args.output)
