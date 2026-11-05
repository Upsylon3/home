"""Disposable filesystem and SQLite proof for mounted-storage exports."""
from pathlib import Path
from contextlib import closing
import importlib
import io
import json
import os
import sqlite3
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
export = importlib.import_module('export')
from snapshot import create


class ExportChecks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='home-export-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source, self.destination = self.root / 'published archives', self.root / 'mounted target'
        self.source.mkdir()
        self.destination.mkdir()

    def archive(self, name='homecore', stamp='2026-11-05_01-00-00'):
        volume = self.root / ('volume-' + name)
        volume.mkdir(exist_ok=True)
        database = volume / 'app.db'
        if not database.exists():
            with closing(sqlite3.connect(database)) as db:
                db.execute('CREATE TABLE example (value TEXT)')
                db.execute("INSERT INTO example VALUES ('restorable')")
                db.commit()
        (volume / 'upload.bin').write_bytes(b'exact archived bytes\x00\xff')
        archive = self.source / f'{name}-backup-{stamp}.tar.gz'
        with tempfile.TemporaryDirectory(dir=self.root) as work:
            create(volume, archive, Path(work))
        return archive

    def run_export(self):
        return export.export_archives(self.source, self.destination)

    def test_export_preserves_all_published_bytes_and_history(self):
        archives = [self.archive(), self.archive('homevault'), self.archive(stamp='2026-11-04_01-00-00')]
        (self.source / 'homecore-backup-2026-11-05_02-00-00.tar.gz.partial.123').write_bytes(b'incomplete')
        (self.source / 'private.env').write_text('disposable fixture; never export')
        original = {p.name: p.read_bytes() for p in archives}
        target = self.run_export()
        manifest = json.loads((target / 'manifest.json').read_text())
        self.assertEqual(manifest['consistency'], 'per-service')
        self.assertFalse(manifest['includesConfiguration'])
        self.assertEqual(export.verify_export(target), 3)
        self.assertEqual({entry['name'] for entry in manifest['archives']}, set(original))
        for name, data in original.items():
            self.assertEqual((target / name).read_bytes(), data)
            self.assertEqual((self.source / name).read_bytes(), data)
        second = self.run_export()
        self.assertNotEqual(target, second)
        self.assertEqual(export.verify_export(target), 3)
        self.assertFalse(any(p.name.startswith('.home-export-') for p in self.destination.iterdir()))

    def test_empty_missing_and_nested_storage_are_refused(self):
        with self.assertRaisesRegex(ValueError, 'No published'):
            self.run_export()
        self.archive()
        for path in [self.source, self.root, self.root / 'missing']:
            with self.assertRaises(ValueError):
                export.export_archives(self.source, path)
        nested = self.source / 'nested'
        nested.mkdir()
        with self.assertRaises(ValueError):
            export.export_archives(self.source, nested)

    def test_corruption_and_copy_failures_preserve_previous_exports(self):
        archive = self.archive()
        previous = self.run_export()
        with mock.patch.object(export.os, 'fsync', side_effect=OSError('disposable write failure')):
            with self.assertRaises(OSError):
                self.run_export()
        with mock.patch.object(export, 'checksum', return_value='wrong'):
            with self.assertRaisesRegex(ValueError, 'bytes failed'):
                self.run_export()
        original = archive.read_bytes()
        archive.write_bytes(original[:-8] + bytes(8))
        with self.assertRaises(Exception):
            self.run_export()
        self.assertEqual(list(self.destination.iterdir()), [previous])
        self.assertEqual(export.verify_export(previous), 1)

    def test_export_verification_refuses_modified_missing_and_extra_files(self):
        self.archive()
        target = self.run_export()
        archive = next(target.glob('*.tar.gz'))
        original = archive.read_bytes()
        archive.write_bytes(original + b'changed')
        with self.assertRaisesRegex(ValueError, 'checksum or size'):
            export.verify_export(target)
        archive.write_bytes(original)
        archive.unlink()
        with self.assertRaisesRegex(ValueError, 'do not match'):
            export.verify_export(target)
        archive.write_bytes(original)
        (target / 'unexpected').touch()
        with self.assertRaisesRegex(ValueError, 'do not match'):
            export.verify_export(target)

    def test_untrusted_manifest_cannot_choose_other_paths(self):
        self.archive()
        target = self.run_export()
        manifest_path = target / 'manifest.json'
        original = json.loads(manifest_path.read_text())
        for name in ['../outside.db', '/outside.db', '..\\outside.db', 'C:outside.db']:
            changed = json.loads(json.dumps(original))
            changed['archives'][0]['name'] = name
            manifest_path.write_text(json.dumps(changed))
            with self.assertRaisesRegex(ValueError, 'Invalid archive'):
                export.verify_export(target)
        original['archives'] *= 2
        manifest_path.write_text(json.dumps(original))
        with self.assertRaisesRegex(ValueError, 'Invalid archive'):
            export.verify_export(target)
        manifest_path.write_bytes(b'x' * (1024 * 1024 + 1))
        with self.assertRaisesRegex(ValueError, 'manifest exceeds'):
            export.verify_export(target)

    def test_archive_database_names_cannot_escape_windows_scratch(self):
        archive = self.source / 'homecore-backup-2026-11-05_01-00-00.tar.gz'
        for name in ['..\\outside.db', 'C:outside.db']:
            with tarfile.open(archive, 'w:gz') as tar:
                member = tarfile.TarInfo(name)
                member.size = 4
                tar.addfile(member, io.BytesIO(b'bad!'))
            with self.assertRaisesRegex(ValueError, 'unsafe database'):
                self.run_export()
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_links_are_refused_without_following_them(self):
        archive = self.archive()
        alias = self.root / 'linked target'
        try:
            alias.symlink_to(self.destination, target_is_directory=True)
        except OSError:
            self.skipTest('Creating symlinks is unavailable on this host')
        with self.assertRaisesRegex(ValueError, 'links or junctions'):
            export.export_archives(self.source, alias)
        archive.unlink()
        archive.symlink_to(self.root / 'outside')
        with self.assertRaisesRegex(ValueError, 'regular file'):
            self.run_export()
        self.assertEqual(list(self.destination.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
