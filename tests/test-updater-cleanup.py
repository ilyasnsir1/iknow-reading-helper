"""Bounded update housekeeping, using only newly created temporary fixtures."""
from pathlib import Path
import base64
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'outputs/iknow-lesehilfe/helper'
if not HELPER.exists():
    HELPER = ROOT / 'helper'
sys.path.insert(0, str(HELPER))
import updater


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='iknow-cleanup-')
        self.root = Path(self.temporary.name)
        self.app, self.cache = self.root / 'App', self.root / 'Cache'
        (self.app / 'extension').mkdir(parents=True)
        (self.app / 'extension/manifest.json').write_text('{"version":"1.34.0"}')
        self.cache.mkdir()
        self.updates = updater.update_root(self.cache, self.app)
        self.updates.mkdir(parents=True)
        self.sequence = 0

    def tearDown(self):
        self.temporary.cleanup()

    def stage(self, state='complete', transaction=True, pid=99999999):
        operation = uuid.uuid4().hex
        path = self.updates / ('stage-' + operation)
        path.mkdir()
        owner = {'schema': 1, 'appRoot': str(self.app), 'cacheRoot': str(self.cache), 'operation': operation,
                 'parentPid' if transaction else 'ownerPid': pid}
        updater.atomic_json(path / ('transaction.json' if transaction else 'stage-owner.json'), owner)
        if state:
            updater.atomic_json(path / 'journal.json', {'state': state, 'files': []})
        (path / 'application.zip').write_bytes(b'fixture download')
        self.sequence += 1
        os.utime(path, ns=(1000000000 * self.sequence, 1000000000 * self.sequence))
        return path

    def test_keeps_three_recent_backups_and_all_personal_files(self):
        stages = [self.stage('complete' if index % 2 else 'rolled_back') for index in range(7)]
        personal = self.updates / 'my-notes'
        personal.mkdir()
        (personal / 'keep.txt').write_text('User data')
        (self.cache / 'models').mkdir()
        (self.cache / 'models/existing.bin').write_bytes(b'Keep existing model')
        (self.app / 'notes.txt').write_text('Keep app notes')
        removed = updater.prune_stages(self.cache, self.app)
        self.assertEqual(set(removed), {p.name for p in stages[:4]})
        self.assertTrue(all(p.exists() for p in stages[4:]))
        self.assertEqual((personal / 'keep.txt').read_text(), 'User data')
        self.assertEqual((self.cache / 'models/existing.bin').read_bytes(), b'Keep existing model')
        self.assertEqual((self.app / 'notes.txt').read_text(), 'Keep app notes')

    def test_active_unfinished_recovery_and_unknown_stages_preserved(self):
        applying = self.stage('applying')
        failed = self.stage('rollback_failed')
        awaiting_runner = self.stage(None)
        active = self.stage('complete')
        live = self.stage('complete', pid=os.getpid())
        unknown = self.updates / ('stage-' + uuid.uuid4().hex)
        unknown.mkdir()
        (unknown / 'unknown.txt').write_text('No ownership marker')
        bad_journal = self.stage(None, transaction=False)
        (bad_journal / 'journal.json').write_text('broken journal')
        updater.atomic_json(updater.state_path(self.cache, self.app), {'status': 'installing', 'operation': active.name[6:]})
        self.assertEqual(updater.prune_stages(self.cache, self.app, keep=0), [])
        self.assertTrue(all(p.exists() for p in [applying, failed, awaiting_runner, active, live, unknown, bad_journal]))

    def test_abandoned_downloads_bounded_and_foreign_ownership_preserved(self):
        stages = [self.stage(None, transaction=False) for _ in range(5)]
        foreign = self.stage('complete')
        owner = updater.read_json(foreign / 'transaction.json')
        owner['appRoot'] = str(self.root / 'Different app')
        updater.atomic_json(foreign / 'transaction.json', owner)
        removed = updater.prune_stages(self.cache, self.app)
        self.assertEqual(set(removed), {p.name for p in stages[:2]})
        self.assertTrue(foreign.exists())

    def test_unsafe_linked_tree_never_descended_or_removed(self):
        candidate = self.stage('complete')
        external = self.root / 'External user folder'
        external.mkdir()
        (external / 'keep.txt').write_text('Keep outside data')
        link = candidate / 'linked'
        junction = False
        try:
            if os.name == 'nt':
                # File operations stay in one PowerShell process and target
                # explicit resolved paths inside this test's temporary folder.
                script = "$ErrorActionPreference='Stop';$v=[Console]::In.ReadToEnd()|ConvertFrom-Json;New-Item -ItemType Junction -Path $v.path -Target $v.target | Out-Null"
                encoded = base64.b64encode(script.encode('utf-16le')).decode('ascii')
                result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
                    input=json.dumps({'path': str(link), 'target': str(external)}).encode(), capture_output=True, timeout=15)
                if result.returncode:
                    self.skipTest('Junction creation unavailable')
                junction = True
            else:
                link.symlink_to(external, target_is_directory=True)
            self.assertTrue(link.exists())
            self.assertFalse(updater._stage_is_safe(candidate, self.updates))
            self.assertEqual(updater.prune_stages(self.cache, self.app, keep=0), [])
            self.assertEqual((external / 'keep.txt').read_text(), 'Keep outside data')
            self.assertTrue(candidate.exists())
        finally:
            # Remove only the verified test junction itself, never its target.
            if junction and link.exists():
                os.rmdir(link)
            elif link.is_symlink():
                link.unlink()

    def test_reparse_root_and_locked_backup_are_preserved(self):
        candidate = self.stage('complete')
        original = updater._stage_is_safe
        with patch.object(updater, '_stage_is_safe', side_effect=lambda path, expected: False if Path(path) == candidate else original(path, expected)):
            self.assertEqual(updater.prune_stages(self.cache, self.app, keep=0), [])
        with patch.object(updater.shutil, 'rmtree', side_effect=PermissionError('Fixture locked file')):
            self.assertEqual(updater.prune_stages(self.cache, self.app, keep=0), [])
        self.assertTrue(candidate.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
