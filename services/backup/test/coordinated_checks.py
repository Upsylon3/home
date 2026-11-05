"""Disposable proof of complete, unchanged, restorable offline sets."""
from pathlib import Path
from contextlib import closing
import importlib
import json
import sqlite3
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
coordinated = importlib.import_module('coordinated')
export = importlib.import_module('export')


class CoordinatedChecks(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='home-coordinated-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source, self.destination = self.root / 'sources', self.root / 'destination'
        self.source.mkdir()
        self.destination.mkdir()
        for name in export.COORDINATED_SOURCES:
            folder = self.source / name
            folder.mkdir()
            filename = 'homecloud.db' if name == 'homecloud-backend' else name + '.db'
            with closing(sqlite3.connect(folder / filename)) as db:
                db.execute('CREATE TABLE example (value TEXT)')
                db.execute('INSERT INTO example VALUES (?)', (name,))
                if name == 'homecloud-backend':
                    db.execute('CREATE TABLE files (user_id INTEGER, stored_name TEXT, size INTEGER, thumbnail_name TEXT)')
                    db.execute("INSERT INTO files VALUES (1, 'shared-file', 5, NULL)")
                db.commit()
        uploads = self.source / 'homecloud-backend/uploads/1'
        uploads.mkdir(parents=True)
        (uploads / 'shared-file').write_bytes(b'exact')

    def capture(self):
        return coordinated.capture(self.source, self.destination, confirm_offline=True)

    def test_complete_set_restores_every_database_and_cloud_bytes_without_source_changes(self):
        before = coordinated.fingerprint(self.source)
        target = self.capture()
        self.assertEqual(coordinated.fingerprint(self.source), before)
        self.assertEqual(export.verify_export(target), 8)
        manifest = json.loads((target / 'manifest.json').read_text())
        self.assertEqual(manifest['consistency'], 'coordinated-offline')
        self.assertEqual(manifest['sourceFingerprint'], before)
        self.assertFalse(manifest['includesConfiguration'])
        for name in export.COORDINATED_SOURCES:
            with tarfile.open(next(target.glob(name + '-backup-*.tar.gz'))) as archive:
                filename = 'homecloud.db' if name == 'homecloud-backend' else name + '.db'
                restored = self.root / filename
                with archive.extractfile('./' + filename) as stream:
                    restored.write_bytes(stream.read())
                with closing(sqlite3.connect(restored)) as db:
                    self.assertEqual(db.execute('SELECT value FROM example').fetchone(), (name,))
                if name == 'homecloud-backend':
                    self.assertEqual(archive.extractfile('./uploads/1/shared-file').read(), b'exact')
        self.assertFalse(any(p.name.startswith('.') for p in self.destination.iterdir()))

    def test_no_confirmation_missing_database_and_corruption_publish_nothing(self):
        with self.assertRaisesRegex(ValueError, 'Stop and verify'):
            coordinated.capture(self.source, self.destination)
        database = self.source / 'homecore/homecore.db'
        original = database.read_bytes()
        for data in [b'', b'corrupt SQLite']:
            database.write_bytes(data)
            with self.assertRaises(Exception):
                self.capture()
            self.assertEqual(list(self.destination.iterdir()), [])
        database.write_bytes(original)
        database.unlink()
        with self.assertRaises(ValueError):
            self.capture()

    def test_mutation_between_archives_and_interruption_preserve_previous_sets(self):
        previous = self.capture()
        real_create = coordinated.create

        def mutate(source, target, scratch):
            real_create(source, target, scratch)
            if source.name == 'homenotes':
                (self.source / 'homecore/late-write').write_text('external writer')

        with mock.patch.object(coordinated, 'create', side_effect=mutate):
            with self.assertRaisesRegex(ValueError, 'Sources changed'):
                self.capture()
        for error in [OSError('write failed'), TimeoutError('deadline')]:
            with mock.patch.object(coordinated, 'create', side_effect=error):
                with self.assertRaises(type(error)):
                    self.capture()
        self.assertEqual(list(self.destination.iterdir()), [previous])
        self.assertEqual(export.verify_export(previous), 8)

    def test_manifest_rejects_partial_sets_and_invalid_interval(self):
        target = self.capture()
        file = target / 'manifest.json'
        original = json.loads(file.read_text())
        for change in [{'archives': original['archives'][:-1]}, {'quiescedAt': '2099-01-01T00:00:00+00:00'},
                       {'sourceFingerprint': 'invalid'}]:
            file.write_text(json.dumps(original | change))
            with self.assertRaises(ValueError):
                export.verify_export(target)
        file.write_text(json.dumps(original))
        self.assertEqual(export.verify_export(target), 8)


if __name__ == '__main__':
    unittest.main()
