"""Fixture-only release packaging checks; no GitHub calls or personal key access."""
from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('publisher', HERE / 'build-release.py')
PUBLISHER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PUBLISHER)


class PublisherChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='iknow-publisher-qa-')
        cls.root = Path(cls.temporary.name)
        cls.keys = cls.root / 'keys'
        subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(HERE / 'create-signing-key.ps1'), '-KeyDirectory', str(cls.keys)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        self.case = self.root / self._testMethodName
        self.package = self.case / 'package'
        (self.package / 'extension').mkdir(parents=True)
        (self.package / 'helper').mkdir()
        config = {'schema': 1, 'owner': 'test-owner', 'repository': 'test-repo', 'enabled': True, 'channel': 'stable', 'publicKeyXml': (self.keys / 'signing-public.xml').read_text()}
        for folder in ('extension', 'helper'):
            (self.package / folder / 'update-config.json').write_text(json.dumps(config))
        (self.package / 'extension/manifest.json').write_text(json.dumps({'version': '1.34.0'}))
        (self.package / 'helper/native_host.py').write_text('HOST_VERSION = "1.16.0"\n')
        (self.package / 'README.md').write_text('Fixture release.\n')
        (self.package / 'RELEASE-FILES.json').write_text('{}')

    def build(self, output='out'):
        return PUBLISHER.build(argparse.Namespace(package=self.package, owner='test-owner', repository='test-repo', output=self.case / output, minimum_helper_version='1.16.0', private_key=self.keys / 'signing-key.xml', replace=False))

    def test_reproducible_signed_package_and_complete_baseline(self):
        manifest = self.build()
        self.build('out-two')
        for name in ('iKnow-Reading-Helper-1.34.0.zip', 'update-manifest.json', 'update-manifest.sig', 'SHA256SUMS.txt'):
            self.assertEqual((self.case / 'out' / name).read_bytes(), (self.case / 'out-two' / name).read_bytes(), name)
        signature = base64.b64decode((self.case / 'out/update-manifest.sig').read_bytes(), validate=False)
        self.assertEqual(len(signature), 384)
        with zipfile.ZipFile(self.case / 'out' / manifest['asset']['name']) as stream:
            self.assertEqual(set(stream.namelist()), set(manifest['files']))
            baseline = json.loads(stream.read('RELEASE-FILES.json'))
            self.assertEqual(set(baseline['sha256']), set(stream.namelist()) - {'RELEASE-FILES.json'})
            for name in stream.namelist():
                self.assertEqual(PUBLISHER.digest(stream.read(name)), manifest['files'][name])

    def test_secret_personal_path_models_and_unexpected_file_rejected(self):
        for name, value in [('helper/test.txt', 'github_pat_' + 'a' * 40), ('helper/test.txt', 'C:\\Users\\PrivateUser\\file.txt'), ('helper/model.gguf', 'x'), ('diagnostics/report.json', '{}')]:
            target = self.package / name
            target.parent.mkdir(exist_ok=True, parents=True)
            target.write_text(value)
            with self.assertRaises(ValueError):
                PUBLISHER.package_files(self.package)
            target.unlink()

    def test_public_source_urls_are_not_personal_paths(self):
        (self.package / 'extension/audio-source.js').write_text('https://assets.iknow.jp/users/Cerego/audio.mp3')
        self.assertIn('extension/audio-source.js', PUBLISHER.package_files(self.package))

    def test_destination_mismatch_rejected(self):
        config_path = self.package / 'helper/update-config.json'
        config = json.loads(config_path.read_text())
        config['repository'] = 'another-repo'
        config_path.write_text(json.dumps(config))
        with self.assertRaisesRegex(ValueError, 'configurations differ'):
            self.build()

    def test_publish_dry_run_verifies_signature_and_archive_without_github(self):
        manifest = self.build()
        notes = self.case / 'notes.txt'
        notes.write_text('Fixture only. No upload.\n')
        command = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(HERE / 'publish-release.ps1'),
                   '-ReleaseDirectory', str(self.case / 'out'), '-PackageDirectory', str(self.package), '-NotesFile', str(notes), '-DryRun']
        checked = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(checked.returncode, 0, checked.stderr)
        self.assertIn('no GitHub changes', checked.stdout)
        archive = self.case / 'out' / manifest['asset']['name']
        archive.write_bytes(archive.read_bytes() + b'tamper')
        rejected = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn('checksum or length', rejected.stderr)

    def publish_with_fake_gh(self, *, existing_release):
        self.build()
        notes = self.case / 'notes.txt'
        notes.write_text('Fixture publication. No network.\n')
        fake_bin = self.case / 'fake-bin'
        fake_bin.mkdir()
        trace = self.case / 'gh-trace.txt'
        (fake_bin / 'gh.cmd').write_bytes(b'''@echo off\r
>>"%IKNOW_TEST_GH_TRACE%" echo %*\r
if "%~1"=="api" (\r
  echo false\r
  exit /b 0\r
)\r
if "%~1 %~2"=="release view" (\r
  if "%IKNOW_TEST_GH_EXISTS%"=="1" exit /b 0\r
  echo gh: release not found 1>&2\r
  exit /b 1\r
)\r
if "%~1 %~2"=="release create" exit /b 0\r
if "%~1 %~2"=="release edit" exit /b 0\r
echo Unexpected fixture command 1>&2\r
exit /b 90\r
''')
        environment = os.environ.copy()
        environment['PATH'] = str(fake_bin) + os.pathsep + environment.get('PATH', '')
        environment['IKNOW_TEST_GH_TRACE'] = str(trace)
        environment['IKNOW_TEST_GH_EXISTS'] = '1' if existing_release else '0'
        command = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(HERE / 'publish-release.ps1'),
                   '-ReleaseDirectory', str(self.case / 'out'), '-PackageDirectory', str(self.package), '-NotesFile', str(notes)]
        result = subprocess.run(command, capture_output=True, text=True, env=environment)
        return result, trace.read_text().splitlines()

    def test_publish_missing_release_stderr_continues_to_create_and_publish(self):
        # Windows PowerShell can promote native stderr to an exception under
        # ErrorActionPreference=Stop even though a missing release is expected.
        result, trace = self.publish_with_fake_gh(existing_release=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([line.split()[:2] for line in trace], [
            ['api', 'repos/test-owner/test-repo'], ['release', 'view'],
            ['release', 'create'], ['release', 'edit'],
        ])
        self.assertIn('--draft', trace[2])
        self.assertIn('--draft=false', trace[3])
        self.assertIn('Published https://github.com/test-owner/test-repo/releases/tag/v1.34.0', result.stdout)

    def test_publish_existing_release_refuses_create_or_replacement(self):
        result, trace = self.publish_with_fake_gh(existing_release=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('already has a release', result.stderr)
        self.assertEqual([line.split()[:2] for line in trace], [
            ['api', 'repos/test-owner/test-repo'], ['release', 'view'],
        ])

    def test_mismatched_signing_key_rejected(self):
        # A different pinned public key must fail before any signature can ship.
        config = json.loads((self.package / 'helper/update-config.json').read_text())
        config['publicKeyXml'] = config['publicKeyXml'].replace('<Exponent>AQAB</Exponent>', '<Exponent>Aw==</Exponent>')
        for folder in ('helper', 'extension'):
            (self.package / folder / 'update-config.json').write_text(json.dumps(config))
        with self.assertRaises(subprocess.CalledProcessError):
            self.build()

    def test_output_inside_package_rejected(self):
        with self.assertRaises(ValueError):
            self.build('package/output')

    def test_path_rules(self):
        for bad in ('../escape.py', '/absolute.py', 'helper/../../outside.py', 'helper/file.key', 'helper/__pycache__/x.py', 'work/script.py', 'C:/bad.py'):
            self.assertFalse(PUBLISHER.accepted_path(bad), bad)


if __name__ == '__main__':
    unittest.main(verbosity=2)
