#!/bin/sh
set -eu

# How often to back up, and how long to keep backups around.
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"   # default: once a day
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"           # default: keep 2 weeks

mkdir -p /backups

# Generalized from a single hardcoded /data mount to one archive per named
# source, each mounted under its own subdirectory of /sources — see
# docker-compose.yml's `backup` service. This started as "just add
# homecloud-backend's new volume alongside homecloud's" (MIGRATION_PLAN.md's
# Phase 5), but the honest answer once actually looking was that
# homemedia_data/homenotes_data/homesync_data were never backed up at all —
# HomeNotes especially, whose database holds real note content, not just a
# cache. Fixed here rather than left as a separate, easy-to-forget backlog
# item, since it's the exact same code path either way. Adding a future
# app's volume to this backup is now one docker-compose.yml mount line, not
# a backup.sh change.
run_backup() {
  timestamp=$(date +%Y-%m-%d_%H-%M-%S)
  any_failed=0

  for source_dir in /sources/*/; do
    [ -d "$source_dir" ] || continue
    name=$(basename "$source_dir")
    dest="/backups/${name}-backup-${timestamp}.tar.gz"
    tmp="${dest}.partial"

    echo "[backup] starting backup of '${name}' -> ${dest}"
    # Writing to a .partial name first and renaming at the end means a
    # backup that gets interrupted mid-write is never mistaken for a
    # complete, restorable one.
    if tar czf "$tmp" -C "$source_dir" .; then
      mv "$tmp" "$dest"
      echo "[backup] finished '${name}': $(du -h "$dest" | cut -f1)"
    else
      echo "[backup] '${name}' FAILED — removing partial file"
      rm -f "$tmp"
      any_failed=1
    fi
  done

  # Prune backups older than the retention window, per source, so an app
  # added later doesn't need its own separate prune rule either.
  for source_dir in /sources/*/; do
    [ -d "$source_dir" ] || continue
    name=$(basename "$source_dir")
    find /backups -name "${name}-backup-*.tar.gz" -mtime "+${RETENTION_DAYS}" -print -delete
  done

  return $any_failed
}

echo "[backup] service starting. Interval: ${INTERVAL_SECONDS}s, retention: ${RETENTION_DAYS} days."
echo "[backup] sources: $(ls /sources 2>/dev/null | tr '\n' ' ')"

# Take one backup immediately on startup, then repeat on the configured
# interval for as long as the container runs. Wrapping the call in an "if"
# means a failure partway through one cycle (a full disk during the mv, a
# permission hiccup during pruning) is logged and skipped rather than
# exiting the whole script under `set -e` — which would otherwise crash
# the entire backup daemon over what should just be "try again next time."
while true; do
  if ! run_backup; then
    echo "[backup] this cycle had at least one failure — will try again at the next interval"
  fi
  sleep "$INTERVAL_SECONDS"
done
