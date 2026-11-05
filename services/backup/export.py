#!/usr/bin/env python3
"""Copy published per-service archives to operator-provided mounted storage.

This exports existing snapshots, not live volumes or installation credentials.
It cannot establish whether a destination is physically off-machine.
"""
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import tempfile
import uuid

from snapshot import verify, interrupted

ARCHIVE = re.compile(r"[A-Za-z0-9_-]+-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.tar\.gz\Z")


def directory(value):
    path = Path(value).absolute()
    for entry in [path, *path.parents]:
        if entry.is_symlink() or (hasattr(entry, 'is_junction') and entry.is_junction()):
            raise ValueError('Storage paths must not pass through links or junctions')
    if not path.is_dir():
        raise ValueError('Storage directory must already exist; check that the intended drive/share is mounted')
    return path.resolve()


def open_archive(path):
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError('Archive must be a regular file, not a link')
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode) or path.is_symlink():
            raise ValueError('Archive must be a regular file, not a link')
        return os.fdopen(descriptor, 'rb')
    except BaseException:
        os.close(descriptor)
        raise


def checksum(path):
    with open_archive(path) as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def restore_check(archive, work):
    # Read the complete gzip stream too, including its CRC/trailer. Tar readers
    # can stop at the end-of-archive blocks before reaching that trailer.
    with gzip.open(archive, 'rb') as stream:
        while stream.read(1024 * 1024):
            pass
    verify(archive, work)


def export_archives(source, destination):
    source, destination = directory(source), directory(destination)
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError('Source and destination must be separate, non-nested directories')
    archives = sorted(entry for entry in source.iterdir() if ARCHIVE.fullmatch(entry.name))
    if not archives:
        raise ValueError('No published backup archives found; run a successful backup cycle first')
    name = 'home-backup-export-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex
    final = destination / name
    # Only this newly allocated temporary directory may be removed on failure.
    with tempfile.TemporaryDirectory(prefix='.home-export-', dir=destination) as temporary:
        stage = Path(temporary)
        entries = []
        with tempfile.TemporaryDirectory(prefix='.restore-', dir=stage) as scratch:
            for archive in archives:
                target = stage / archive.name
                digest = hashlib.sha256()
                with open_archive(archive) as src, target.open('xb') as dst:
                    os.chmod(target, 0o600)
                    before = os.fstat(src.fileno())
                    while chunk := src.read(1024 * 1024):
                        digest.update(chunk)
                        dst.write(chunk)
                    dst.flush()
                    os.fsync(dst.fileno())
                    after = os.fstat(src.fileno())
                if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    raise ValueError('Source archive changed during export; retry')
                if checksum(target) != digest.hexdigest() or target.stat().st_size != before.st_size:
                    raise ValueError('Destination bytes failed verification')
                restore_check(target, Path(scratch))
                entries.append({'name': archive.name, 'size': before.st_size, 'sha256': digest.hexdigest()})
        manifest = {'schema': 1, 'createdAt': datetime.now(timezone.utc).isoformat(),
                    'consistency': 'per-service', 'includesConfiguration': False, 'archives': entries}
        if len(json.dumps(manifest, indent=2).encode('utf-8')) + 1 > 1024 * 1024:
            raise ValueError('Export inventory exceeds the supported manifest size')
        manifest_path = stage / 'manifest.json'
        with manifest_path.open('x', encoding='utf-8') as stream:
            os.chmod(manifest_path, 0o600)
            json.dump(manifest, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        if final.exists():
            raise ValueError('Export destination already exists; refusing to replace it')
        # Existing backup archives are root-owned/private in the container.
        # The export helper reads them as root, then gives its new output to
        # the destination owner so host users can read their private exports.
        if hasattr(os, 'geteuid') and os.geteuid() == 0:
            owner = destination.stat()
            for entry in [*stage.iterdir(), stage]:
                current = entry.stat()
                if (current.st_uid, current.st_gid) != (owner.st_uid, owner.st_gid):
                    os.chown(entry, owner.st_uid, owner.st_gid)
        stage.rename(final)
    return final


def verify_export(folder):
    folder = directory(folder)
    manifest_path = folder / 'manifest.json'
    with open_archive(manifest_path) as stream:
        raw = stream.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError('Export manifest exceeds the supported size')
    manifest = json.loads(raw)
    if not isinstance(manifest, dict) or manifest.get('schema') != 1 or \
            manifest.get('consistency') != 'per-service' or manifest.get('includesConfiguration') is not False or \
            not isinstance(manifest.get('archives'), list) or not manifest['archives']:
        raise ValueError('Unsupported or empty export manifest')
    names = set()
    for entry in manifest['archives']:
        if not isinstance(entry, dict) or not isinstance(entry.get('name'), str) or \
                not ARCHIVE.fullmatch(entry['name']) or entry['name'] in names or \
                type(entry.get('size')) is not int or entry['size'] < 0 or \
                not isinstance(entry.get('sha256'), str) or not re.fullmatch('[a-f0-9]{64}', entry['sha256']):
            raise ValueError('Invalid archive entry in export manifest')
        names.add(entry['name'])
    if {entry.name for entry in folder.iterdir()} != names | {'manifest.json'}:
        raise ValueError('Export files do not match the manifest')
    with tempfile.TemporaryDirectory(prefix='home-export-verify-') as scratch:
        for entry in manifest['archives']:
            archive = folder / entry['name']
            if checksum(archive) != entry['sha256'] or archive.stat().st_size != entry['size']:
                raise ValueError('Export checksum or size does not match')
            restore_check(archive, Path(scratch))
    return len(names)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='published backups directory, or export folder with --verify')
    parser.add_argument('destination', type=Path, nargs='?')
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    if args.verify == (args.destination is not None):
        parser.error('Use SOURCE DESTINATION to export, or --verify EXPORT-FOLDER')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        if args.verify:
            count = verify_export(args.source)
            print(f'Verified {count} exported archives: checksums, SQLite integrity and file references.')
        else:
            target = export_archives(args.source, args.destination)
            print('Verified export: ' + target.name)
            print('Only published per-service archives were copied. Configuration and coordinated snapshots are not included.')
            print('Confirm this destination is on separate storage. Keep it private; ordinary app data is not encrypted.')
    except Exception as error:
        parser.exit(1, f'Backup export failed: {error}\n')


if __name__ == '__main__':
    main()
