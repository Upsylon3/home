#!/usr/bin/env python3
"""Create and restore-check per-volume archives without copying live SQLite files.

Only root-level *.db files are application databases; an uploaded database is
ordinary user content. Sources stay read-only, including their WAL sidecars.
No third-party Python packages or access to the Docker socket are needed.
"""

import argparse
from contextlib import closing
from pathlib import Path, PurePosixPath
import shutil
import signal
import sqlite3
import stat
import tarfile
import tempfile


def readonly(path):
    # immutable=1 is NOT safe here: it ignores committed transactions in WAL.
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)


def check_database(db):
    if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
        raise ValueError("SQLite integrity check failed")


def snapshot(source, target):
    with closing(readonly(source)) as src, closing(sqlite3.connect(target)) as dst:
        # Pin a read transaction so frequent writers cannot keep restarting
        # the incremental backup. WAL writers can still commit concurrently.
        src.execute("BEGIN")
        if src.execute("SELECT name FROM sqlite_schema LIMIT 1").fetchone() is None:
            raise ValueError("application database has no schema")
        src.backup(dst, pages=256, sleep=0.05)
        # A standalone snapshot must not require a WAL during restore.
        dst.execute("PRAGMA journal_mode=DELETE")
        check_database(dst)


def cloud_references(db):
    # Include trash: it is recoverable until permanently deleted. Uploaded
    # bytes are immutable; rename/move only changes metadata in HomeCloud.
    for user, stored, size, thumbnail in db.execute(
        "SELECT user_id, stored_name, size, thumbnail_name FROM files"
    ):
        if not isinstance(user, int) or user <= 0 or not isinstance(size, int) or size < 0:
            raise ValueError("invalid HomeCloud file metadata")
        for name, expected_size in ((stored, size), (thumbnail, None)):
            if name is None and expected_size is None:
                continue
            if not isinstance(name, str) or not name or name in (".", "..") or \
                    "/" in name or "\\" in name:
                raise ValueError("invalid HomeCloud stored filename")
            yield f"uploads/{user}/{name}", expected_size


def verify(archive, work):
    """Restore only databases into scratch; validate referenced archive members.

    Never extract arbitrary member paths. Large uploads need no second copy.
    GNU tar in backup.sh additionally reads the entire compressed archive.
    """
    with tarfile.open(archive, "r:gz") as tar:
        members = {}
        for member in tar:
            name = member.name.removeprefix("./")
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or name in members or \
                    not (member.isfile() or member.isdir()):
                raise ValueError("unsafe or duplicate archive member")
            members[name] = member
        databases = [name for name, m in members.items()
                     if m.isfile() and "/" not in name and name.endswith(".db")]
        if not databases:
            raise ValueError("source has no root-level SQLite database")
        for name in databases:
            if any(name + suffix in members for suffix in ("-wal", "-shm", "-journal")):
                raise ValueError("archive contains live SQLite sidecars")
            target = work / name
            with tar.extractfile(members[name]) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)
            with closing(readonly(target)) as db:
                check_database(db)
                if name == "homecloud.db":
                    for filename, size in cloud_references(db):
                        member = members.get(filename)
                        if member is None or not member.isfile() or \
                                (size is not None and member.size != size):
                            raise ValueError(f"missing or wrong-size HomeCloud file: {filename}")
            target.unlink()


def add_files(tar, source, relative, excluded):
    for path in sorted((source / relative).iterdir()):
        name = path.relative_to(source)
        if name.as_posix() in excluded:
            continue
        if len(name.parts) == 1 and name.suffix == ".db":
            raise ValueError("application database appeared during backup; retry the cycle")
        info = path.lstat()
        if stat.S_ISDIR(info.st_mode):
            tar.add(path, arcname="./" + name.as_posix(), recursive=False)
            add_files(tar, source, name, excluded)
        elif stat.S_ISREG(info.st_mode):
            # Open once so unlinking an already opened immutable upload cannot
            # truncate its archived contents. Detect ordinary in-place changes.
            with path.open("rb") as stream:
                entry = tar.gettarinfo(arcname="./" + name.as_posix(), fileobj=stream)
                tar.addfile(entry, stream)
            after = path.stat()
            if (info.st_ino, info.st_size, info.st_mtime_ns) != \
                    (after.st_ino, after.st_size, after.st_mtime_ns):
                raise ValueError(f"file changed during backup: {name}")
        else:
            raise ValueError(f"unsupported source entry (links/devices are not archived): {name}")


def create(source, archive, work):
    if source.is_symlink():
        raise ValueError("source volume must not be a symlink")
    databases = sorted(source.glob("*.db"))
    if not databases:
        raise ValueError("source has no root-level SQLite database")
    excluded = set()
    for db in databases:
        if not stat.S_ISREG(db.lstat().st_mode):
            raise ValueError("application database must be a regular file")
        snapshot(db, work / db.name)
        excluded.update(db.name + suffix for suffix in ("", "-wal", "-shm", "-journal"))
    with tarfile.open(archive, "w:gz", dereference=True) as tar:
        for db in databases:
            tar.add(work / db.name, arcname="./" + db.name, recursive=False)
        add_files(tar, source, Path("."), excluded)
    for db in databases:
        (work / db.name).unlink()
    verify(archive, work)


def interrupted(signum, frame):
    # Let TemporaryDirectory clean up when the shell's deadline expires.
    raise TimeoutError("backup interrupted or exceeded its deadline")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="volume directory, or archive with --verify")
    parser.add_argument("archive", type=Path, nargs="?")
    parser.add_argument("--verify", action="store_true", help="restore-check an existing archive")
    args = parser.parse_args()
    if not args.verify and args.archive is None:
        parser.error("archive path is required")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    # Snapshots use backup storage, not the small container writable layer.
    archive = args.source if args.verify else args.archive
    try:
        with tempfile.TemporaryDirectory(prefix=".snapshot-", dir=archive.parent) as tmp:
            if args.verify:
                verify(archive, Path(tmp))
            else:
                create(args.source, archive, Path(tmp))
    except (OSError, ValueError, sqlite3.Error, tarfile.TarError) as err:
        parser.exit(1, f"[backup] snapshot/restore verification failed: {err}\n")


if __name__ == "__main__":
    main()
