"""Create a bounded, reproducible update ZIP and sign its exact manifest bytes.

This publisher-only tool never reads credentials or models and does not upload.
Its default input is the reviewed unpacked sharing folder, not the workspace.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
import zipfile

MAX_PACKAGE = 64 * 1024 * 1024
BAD_SUFFIXES = {'.aivmx', '.aivm', '.gguf', '.onnx', '.bin', '.dll', '.exe', '.wav', '.mp3', '.mp4', '.pyc', '.pyo', '.log', '.pem', '.key', '.zip', '.7z'}
BAD_PARTS = {'__pycache__', '.git', '.codex', 'node_modules', 'models', 'runtime', 'profiles', 'downloads', 'cache', 'keys'}
TOKEN = re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{25,}|hf_[A-Za-z0-9]{25,}|-----BEGIN (?:RSA )?PRIVATE KEY-----|<RSAKeyValue>[^\r\n]*<D>)')
PERSONAL_PATH = re.compile(rb'(?:(?i:[A-Z]:\\{1,2}Users\\{1,2}[^\\\r\n"\x27]+)|/Users/[^/\r\n"\x27]+/)')
SLUG = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\Z')
VERSION = re.compile(r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*))?\Z')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def accepted_path(path):
    name = PurePosixPath(path)
    if name.is_absolute() or '\\' in path or ':' in path or any(part in ('', '.', '..') for part in path.split('/')):
        return False
    if any(part.lower() in BAD_PARTS for part in name.parts) or name.suffix.lower() in BAD_SUFFIXES:
        return False
    if len(name.parts) == 1:
        return path == '.gitignore' or name.suffix.lower() in {'.md', '.txt', '.json', '.cmd'}
    return name.parts[0] in {'extension', 'helper'}


def package_files(package):
    result, insensitive = {}, set()
    size = 0
    for path in sorted(package.rglob('*')):
        if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()):
            raise ValueError('Links are not permitted in a release package.')
        if not path.is_file():
            continue
        relative = path.relative_to(package).as_posix()
        if not accepted_path(relative):
            raise ValueError(f'Unexpected release file: {relative}')
        if relative.casefold() in insensitive:
            raise ValueError(f'Case-insensitive duplicate: {relative}')
        insensitive.add(relative.casefold())
        data = path.read_bytes()
        size += len(data)
        if size > MAX_PACKAGE:
            raise ValueError('The release exceeds the bounded update package limit.')
        if TOKEN.search(data) or PERSONAL_PATH.search(data):
            raise ValueError(f'Credential or personal filesystem path detected: {relative}')
        result[relative] = data
    for needed in ('extension/manifest.json', 'helper/native_host.py', 'RELEASE-FILES.json', 'extension/update-config.json', 'helper/update-config.json'):
        if needed not in result:
            raise ValueError(f'Missing release file: {needed}')
    return result


def build(args):
    package = args.package.resolve(strict=True)
    output = args.output.resolve()
    if output == package or output.is_relative_to(package):
        raise ValueError('Publisher output must be outside the input package.')
    if not SLUG.fullmatch(args.owner) or not SLUG.fullmatch(args.repository):
        raise ValueError('Invalid GitHub owner/repository.')
    data = package_files(package)
    manifest = json.loads(data['extension/manifest.json'])
    version = manifest['version']
    if not VERSION.fullmatch(version) or not VERSION.fullmatch(args.minimum_helper_version):
        raise ValueError('Invalid version.')
    host = re.search(rb'^HOST_VERSION = "([0-9.]+)"', data['helper/native_host.py'], re.MULTILINE)
    if not host or not VERSION.fullmatch(host.group(1).decode()):
        raise ValueError('Helper version is missing.')
    config = json.loads(data['helper/update-config.json'])
    if config != json.loads(data['extension/update-config.json']):
        raise ValueError('Helper and extension update configurations differ.')
    if config.get('schema') != 1 or config.get('owner') != args.owner or config.get('repository') != args.repository or not config.get('enabled'):
        raise ValueError('Package update configuration does not match the release destination.')
    public = config.get('publicKeyXml', '')
    if not public.startswith('<RSAKeyValue>') or '<D>' in public:
        raise ValueError('The package must contain a public-only RSA key.')
    # The updater's old-file safety check needs every managed file, including
    # root documentation; the checksum manifest cannot recursively hash itself.
    baseline = {'version': version, 'sha256': {name: digest(value) for name, value in data.items() if name != 'RELEASE-FILES.json'}}
    data['RELEASE-FILES.json'] = (json.dumps(baseline, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    output.mkdir(parents=True, exist_ok=True)
    asset_name = f'iKnow-Reading-Helper-{version}.zip'
    archive = output / asset_name
    if archive.exists() and not args.replace:
        raise ValueError('Release output exists; choose a new directory or explicitly use --replace.')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as stream:
        for name, value in sorted(data.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            stream.writestr(info, value, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    raw = archive.read_bytes()
    release = {'schema': 1, 'version': version, 'helperVersion': host.group(1).decode(),
               'minimumHelperVersion': args.minimum_helper_version,
               'asset': {'name': asset_name, 'url': f'https://github.com/{args.owner}/{args.repository}/releases/download/v{version}/{asset_name}',
                         'sha256': digest(raw), 'size': len(raw)},
               'files': {name: digest(value) for name, value in sorted(data.items())}, 'deleteFiles': []}
    manifest_path = output / 'update-manifest.json'
    manifest_path.write_bytes((json.dumps(release, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    signature_path = output / 'update-manifest.sig'
    with tempfile.TemporaryDirectory(prefix='iknow-public-key-') as temporary:
        public_path = Path(temporary) / 'public.xml'
        public_path.write_text(public, encoding='utf-8')
        subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(Path(__file__).with_name('sign-manifest.ps1')),
                        '-ManifestPath', str(manifest_path), '-PrivateKeyPath', str(args.private_key.resolve(strict=True)),
                        '-SignaturePath', str(signature_path), '-PublicKeyPath', str(public_path)], check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    checksums = {path.name: digest(path.read_bytes()) for path in (archive, manifest_path, signature_path)}
    (output / 'SHA256SUMS.txt').write_text(''.join(f'{value}  {name}\n' for name, value in sorted(checksums.items())), encoding='utf-8')
    print(json.dumps({'version': version, 'helperVersion': release['helperVersion'], 'files': len(data), 'archiveBytes': len(raw), 'output': str(output)}, indent=2))
    return release


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--owner', required=True)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--minimum-helper-version', default='1.16.0')
    parser.add_argument('--private-key', type=Path, default=Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'iKnowReadingHelperPublisher/signing-key.xml')
    parser.add_argument('--replace', action='store_true')
    return parser.parse_args()


if __name__ == '__main__':
    build(arguments())
