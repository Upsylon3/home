#!/bin/sh
set -eu

# How often to back up, and how long to keep backups around.
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"   # default: once a day
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"           # default: keep 2 weeks
SOURCE_ROOT="${BACKUP_SOURCE_DIR:-/sources}"
DEST_ROOT="${BACKUP_DIR:-/backups}"
TIMEOUT_SECONDS="${BACKUP_TIMEOUT_SECONDS:-3600}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

case "$INTERVAL_SECONDS" in ''|*[!0-9]*|0) echo "[backup] invalid interval" >&2; exit 1 ;; esac
if ! [ "$INTERVAL_SECONDS" -gt 0 ]; then echo "[backup] invalid interval" >&2; exit 1; fi
case "$RETENTION_DAYS" in ''|*[!0-9]*) echo "[backup] invalid retention" >&2; exit 1 ;; esac
case "$TIMEOUT_SECONDS" in ''|*[!0-9]*|0) echo "[backup] invalid timeout" >&2; exit 1 ;; esac
if ! [ "$TIMEOUT_SECONDS" -gt 0 ]; then echo "[backup] invalid timeout" >&2; exit 1; fi
case "${1:-}" in ''|--once) ;; *) echo "Usage: backup.sh [--once]" >&2; exit 1 ;; esac
mkdir -p "$DEST_ROOT"

# One archive per named source, each mounted under its own subdirectory
# of /sources — see docker-compose.yml's `backup` service. Adding a
# future app's volume to this backup is one docker-compose.yml mount
# line, not a backup.sh change.
run_backup() {
  timestamp=$(date +%Y-%m-%d_%H-%M-%S) || return 1
  any_failed=0
  source_count=0

  for source_dir in "$SOURCE_ROOT"/*/; do
    [ -d "$source_dir" ] || continue
    source_count=$((source_count + 1))
    name=$(basename "$source_dir")
    # These are service names, not arbitrary glob patterns for retention.
    case "$name" in *[!a-zA-Z0-9_-]*)
      echo "[backup] invalid source name '${name}'" >&2
      any_failed=1
      continue
    ;; esac
    dest="${DEST_ROOT}/${name}-backup-${timestamp}.tar.gz"
    if [ -e "$dest" ]; then
      echo "[backup] '${name}' FAILED — destination already exists" >&2
      any_failed=1
      continue
    fi
    if ! tmp=$(mktemp "${dest}.partial.XXXXXX"); then
      echo "[backup] '${name}' FAILED — couldn't create temporary archive" >&2
      any_failed=1
      continue
    fi

    echo "[backup] starting backup of '${name}' -> ${dest}"
    # Writing to a unique .partial.* name first and renaming at the end means a
    # backup that gets interrupted mid-write is never mistaken for a
    # complete, restorable one.
    # Check every command explicitly: run_backup is called in an if, so
    # POSIX shells disable set -e inside the entire function.
    # GNU coreutils is installed by the Dockerfile. --no-clobber plus the
    # source check also detects another process publishing this timestamp
    # first; -T prevents moving an archive inside an unexpected directory.
    if timeout --kill-after=10s "$TIMEOUT_SECONDS" python3 "$SCRIPT_DIR/snapshot.py" "$source_dir" "$tmp" && \
      tar tzf "$tmp" >/dev/null && \
      mv -T --no-clobber "$tmp" "$dest" && [ ! -e "$tmp" ]; then
      echo "[backup] finished '${name}'"
      # A failed source keeps ALL its old backups, however old they are.
      # Retention is allowed only after this source has a published,
      # readable replacement. Never descend into unrelated directories.
      if ! find "$DEST_ROOT" -maxdepth 1 -type f -name "${name}-backup-*.tar.gz" \
        ! -name "$(basename "$dest")" -mtime "+${RETENTION_DAYS}" -print -delete; then
        echo "[backup] '${name}' retention FAILED" >&2
        any_failed=1
      fi
    else
      echo "[backup] '${name}' FAILED — preserving previous backups" >&2
      rm -f "$tmp" || echo "[backup] couldn't remove '${tmp}'" >&2
      any_failed=1
    fi
  done

  if [ "$source_count" -eq 0 ]; then
    echo "[backup] no source volumes found" >&2
    any_failed=1
  fi

  return $any_failed
}

echo "[backup] service starting. Interval: ${INTERVAL_SECONDS}s, retention: ${RETENTION_DAYS} days."
echo "[backup] source root: ${SOURCE_ROOT}"

if [ "${1:-}" = "--once" ]; then
  if run_backup; then exit 0; else exit 1; fi
fi

# Take one backup immediately on startup, then repeat on the configured
# interval for as long as the container runs. Wrapping the call in an "if"
# keeps the daemon alive after a failed cycle. Every failure inside the
# function must therefore be checked explicitly, not left to set -e.
while true; do
  if ! run_backup; then
    echo "[backup] this cycle had at least one failure — will try again at the next interval"
  fi
  sleep "$INTERVAL_SECONDS"
done
