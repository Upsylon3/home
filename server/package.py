"""Archive only a fresh runtime bundle; never package an installation's data."""
import pathlib
import sys
import tarfile
import zipfile

source = pathlib.Path(sys.argv[1]).resolve()
target = pathlib.Path(sys.argv[2]).resolve()
allowed = {'setup', 'configuration', 'home.sh', 'home.ps1', 'home.cmd',
           'START-HERE.md', 'LICENSE', 'compose-template.json', 'bundle.json',
           'installer-image.txt', 'images.tar'}
if set(p.name for p in source.iterdir()) != allowed:
    raise SystemExit('Unexpected or missing bundle files; refusing to package runtime state.')
if set(p.name for p in (source / 'configuration').iterdir()) != {'Caddyfile'}:
    raise SystemExit('Configuration contains runtime state; refusing to package credentials.')
files = sorted(source.rglob('*'))
if any(p.is_symlink() for p in files):
    raise SystemExit('Bundle contains a symbolic link.')
if target.exists():
    raise SystemExit('Refusing to replace an existing archive.')
if target.suffix == '.zip':
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for entry in files:
            archive.write(entry, pathlib.Path('home-server') / entry.relative_to(source))
else:
    with tarfile.open(target, 'x:gz') as archive:
        archive.add(source, arcname='home-server')
