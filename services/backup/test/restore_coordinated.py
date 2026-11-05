"""CI-only restore of known fixture databases and their related file bytes."""
from contextlib import closing
from pathlib import Path
import importlib
import sqlite3
import sys
import tarfile
import tempfile

sys.dont_write_bytecode = True
sys.path.insert(0, '/')
export = importlib.import_module('export')
folder = Path(sys.argv[1])
assert export.verify_export(folder) == 8
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    databases = {}
    for source in export.COORDINATED_SOURCES:
        filename = 'homecloud.db' if source == 'homecloud-backend' else source + '.db'
        target = root / filename
        with tarfile.open(next(folder.glob(source + '-backup-*.tar.gz'))) as archive:
            with archive.extractfile('./' + filename) as stream:
                target.write_bytes(stream.read())
        databases[source] = target
    with closing(sqlite3.connect(databases['homecore'])) as core:
        user = core.execute("SELECT id FROM users WHERE username = 'installer-owner'").fetchone()[0]
    with closing(sqlite3.connect(databases['homenotes'])) as notes:
        assert notes.execute('SELECT user_id, content FROM notes WHERE id = ?', (sys.argv[3],)).fetchone() == (user, 'retained app data')
    with closing(sqlite3.connect(databases['homecloud-backend'])) as cloud:
        owner, stored = cloud.execute('SELECT user_id, stored_name FROM files WHERE id = ?', (sys.argv[2],)).fetchone()
        assert owner == user
    with tarfile.open(next(folder.glob('homecloud-backend-backup-*.tar.gz'))) as archive:
        with archive.extractfile(f'./uploads/{owner}/{stored}') as stream:
            assert stream.read() == b'installer persistence proof'
print('Restored coordinated set: matching Core owner, Notes content and exact Cloud bytes.')
