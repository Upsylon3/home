#!/bin/sh
set -eu

# How often to back up, and how long to keep backups around.
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"   # default: once a day
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"           # default: keep 2 weeks

mkdir -p /backups

run_backup() {
  timestamp=$(date +%Y-%m-%d_%H-%M-%S)
  dest="/backups/homecloud-backup-${timestamp}.tar.gz"
  tmp="${dest}.partial"

  echo "[backup] starting backup -> ${dest}"
  # Snapshot everything in /data (the SQLite database + all uploaded files)
  # into a single compressed archive. Writing to a .partial name first and
  # renaming at the end means a backup that gets interrupted mid-write is
  # never mistaken for a complete, restorable one.
  if tar czf "$tmp" -C /data .; then
    mv "$tmp" "$dest"
    echo "[backup] finished: $(du -h "$dest" | cut -f1)"
  else
    echo "[backup] FAILED — removing partial file"
    rm -f "$tmp"
  fi

  # Prune backups older than the retention window.
  find /backups -name 'homecloud-backup-*.tar.gz' -mtime "+${RETENTION_DAYS}" -print -delete
}

echo "[backup] service starting. Interval: ${INTERVAL_SECONDS}s, retention: ${RETENTION_DAYS} days."

# Take one backup immediately on startup, then repeat on the configured
# interval for as long as the container runs. Wrapping the call in an "if"
# means a failure partway through one cycle (a full disk during the mv, a
# permission hiccup during pruning) is logged and skipped rather than
# exiting the whole script under `set -e` — which would otherwise crash
# the entire backup daemon over what should just be "try again next time."
while true; do
  if ! run_backup; then
    echo "[backup] this cycle failed — will try again at the next interval"
  fi
  sleep "$INTERVAL_SECONDS"
done
