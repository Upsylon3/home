"""CI only: inspect archives from the disposable, running Compose stack."""

from contextlib import closing
from pathlib import Path
import sqlite3
import tarfile
import tempfile

from snapshot import verify


root = Path("/backups/ci-restore-check")
sources = ("homecore", "homecloud-backend", "homemedia", "homenotes",
           "homesync", "hometasks", "homemonitor", "homevault")
assert len(list(root.glob("*.tar.gz"))) == len(sources)
with tempfile.TemporaryDirectory() as tmp:
    work = Path(tmp)
    for source in sources:
        archives = list(root.glob(f"{source}-backup-*.tar.gz"))
        assert len(archives) == 1, source
        verify(archives[0], work)
        print(f"ok  restored SQLite integrity and file references: {source}")
        if source not in ("homecore", "homecloud-backend"):
            continue
        name = "homecore.db" if source == "homecore" else "homecloud.db"
        with tarfile.open(archives[0]) as tar:
            target = work / name
            target.write_bytes(tar.extractfile("./" + name).read())
            with closing(sqlite3.connect(target)) as db:
                if source == "homecore":
                    assert db.execute("SELECT role FROM users WHERE username='ci-admin'").fetchone() == ("admin",)
                else:
                    user, stored = db.execute(
                        "SELECT user_id, stored_name FROM files WHERE original_name='backup-smoke.txt'"
                    ).fetchone()
                    assert tar.extractfile(f"./uploads/{user}/{stored}").read() == b"backup restore smoke\n"
                # A restore must work as a writable application database too.
                db.execute("CREATE TABLE backup_restore_probe (value INTEGER)")
                db.execute("INSERT INTO backup_restore_probe VALUES (1)")
                db.commit()
            target.unlink()
print("ok  restored account, uploaded bytes and writable databases")
