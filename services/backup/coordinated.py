#!/usr/bin/env python3
"""Capture a complete archive set while every source writer is stopped.

The managed host launcher proves its container barrier. Direct callers must
establish the same offline precondition themselves. No Docker socket is used.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import tempfile
import uuid

from snapshot import create, interrupted
from export import COORDINATED_SOURCES, directory, open_archive, checksum, restore_check, publish_export


def fingerprint(root):
    digest = hashlib.sha256()

    def visit(entry):
        info = entry.lstat()
        if stat.S_ISDIR(info.st_mode):
            kind, content = 'directory', ''
        elif stat.S_ISREG(info.st_mode):
            kind = 'file'
            with open_archive(entry) as stream:
                content = hashlib.file_digest(stream, 'sha256').hexdigest()
        else:
            raise ValueError('Snapshot sources contain a link or special file')
        after = entry.lstat()
        identity = lambda value: (value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns, value.st_mode)
        if identity(info) != identity(after):
            raise ValueError('Source changed while fingerprinting; keep all writers stopped')
        digest.update(json.dumps([entry.relative_to(root).as_posix(), kind, identity(info), content]).encode('utf-8'))
        digest.update(b'\n')
        if kind == 'directory':
            for child in sorted(entry.iterdir()):
                visit(child)

    for name in sorted(COORDINATED_SOURCES):
        visit(root / name)
    return digest.hexdigest()


def capture(source, destination, *, confirm_offline=False, quiesced_at=None):
    if not confirm_offline:
        raise ValueError('Stop and verify every source writer before capturing; use the host snapshot action')
    source, destination = directory(source), directory(destination)
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError('Source and destination must be separate, non-nested directories')
    if {entry.name for entry in source.iterdir()} != set(COORDINATED_SOURCES) or \
            any(not (source / name).is_dir() or (source / name).is_symlink() for name in COORDINATED_SOURCES):
        raise ValueError('Coordinated snapshot requires all eight source directories')
    for source_name in COORDINATED_SOURCES:
        database = source / source_name / ('homecloud.db' if source_name == 'homecloud-backend' else source_name + '.db')
        if not database.is_file() or database.is_symlink() or database.stat().st_size == 0:
            raise ValueError('A required application database is missing or empty')
    quiet = datetime.fromisoformat(quiesced_at) if quiesced_at else datetime.now(timezone.utc)
    if quiet.tzinfo is None or quiet > datetime.now(timezone.utc):
        raise ValueError('Invalid quiesced time')
    before = fingerprint(source)
    stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d_%H-%M-%S')
    name = 'home-snapshot-' + stamp + '-' + uuid.uuid4().hex
    with tempfile.TemporaryDirectory(prefix='.home-snapshot-', dir=destination) as temporary:
        stage, entries = Path(temporary), []
        with tempfile.TemporaryDirectory(prefix='.restore-', dir=stage) as scratch:
            for source_name in COORDINATED_SOURCES:
                target = stage / f'{source_name}-backup-{stamp}.tar.gz'
                # The existing snapshotter produces standalone databases and
                # validates Cloud references without granting source writes.
                create(source / source_name, target, Path(scratch))
                os.chmod(target, 0o600)
                with target.open('r+b') as stream:
                    os.fsync(stream.fileno())
                restore_check(target, Path(scratch))
                entries.append({'name': target.name, 'size': target.stat().st_size, 'sha256': checksum(target)})
        if fingerprint(source) != before:
            raise ValueError('Sources changed during the coordinated snapshot; no set was published')
        manifest = {'schema': 1, 'consistency': 'coordinated-offline', 'includesConfiguration': False,
                    'quiescedAt': quiet.isoformat(), 'createdAt': datetime.now(timezone.utc).isoformat(),
                    'sourceFingerprint': before, 'archives': entries}
        return publish_export(stage, destination, name, manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--confirm-offline', action='store_true')
    parser.add_argument('--quiesced-at')
    parser.add_argument('--timeout', type=int, default=3600, help='total capture deadline in seconds')
    args = parser.parse_args()
    if not 1 <= args.timeout <= 86400:
        parser.error('timeout must be between 1 and 86400 seconds')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    if hasattr(signal, 'SIGALRM'):
        signal.signal(signal.SIGALRM, interrupted)
        signal.alarm(args.timeout)
    try:
        target = capture(args.source, args.destination, confirm_offline=args.confirm_offline, quiesced_at=args.quiesced_at)
        print('Verified coordinated snapshot: ' + target.name)
    except Exception as error:
        parser.exit(1, f'Coordinated snapshot failed: {error}\n')
    finally:
        if hasattr(signal, 'SIGALRM'):
            signal.alarm(0)


if __name__ == '__main__':
    main()
