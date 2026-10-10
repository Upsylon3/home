// Are backups happening? We look in the backup folder (mounted read-only).
//
// The backup service (services/backup/backup.sh) writes one archive per app
// volume, named like  homecore-backup-2026-10-09_02-00-00.tar.gz, and writes
// to a ".partial" name first, renaming only when finished. So:
//   * a name ending ".tar.gz" is a COMPLETE backup,
//   * ".partial" files are ignored (an unfinished one is not a backup),
//   * the age we judge by is the file's modified time, because the timestamp in
//     the name has no time zone.
const fs = require("fs");
const path = require("path");

const NAME = /^(.+)-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.tar\.gz$/;

// "homecore-backup-2026-10-09_02-00-00.tar.gz" -> "homecore". null if it isn't one of ours.
function parseBackupName(filename) {
  const match = filename.match(NAME);
  return match ? match[1] : null;
}

// Pure: summarize a list of files.  files = [{ name, size, mtimeMs }]
// Overall status:
//   "none"  no complete backup at all
//   "stale" at least one source's newest backup is older than maxAgeHours
//   "ok"    every source has a recent one
function summarizeBackups(files, nowMs, maxAgeHours) {
  const bySource = new Map();
  for (const file of files) {
    const source = parseBackupName(file.name);
    if (!source) continue;
    const entry = bySource.get(source) || { source, count: 0, latestMs: 0, latestSize: 0 };
    entry.count += 1;
    if (file.mtimeMs > entry.latestMs) {
      entry.latestMs = file.mtimeMs;
      entry.latestSize = file.size;
    }
    bySource.set(source, entry);
  }

  const sources = [...bySource.values()]
    .map((entry) => {
      const ageHours = (nowMs - entry.latestMs) / 3_600_000;
      return {
        source: entry.source,
        count: entry.count,
        latestAt: new Date(entry.latestMs).toISOString(),
        ageHours: Math.max(0, Math.round(ageHours * 10) / 10),
        latestSize: entry.latestSize,
        status: ageHours > maxAgeHours ? "stale" : "ok"
      };
    })
    .sort((a, b) => a.source.localeCompare(b.source));

  if (sources.length === 0) return { status: "none", detail: "No completed backups found.", maxAgeHours, sources: [] };
  const stale = sources.filter((s) => s.status === "stale");
  return {
    status: stale.length ? "stale" : "ok",
    detail: stale.length ? `${stale.map((s) => s.source).join(", ")} not backed up for over ${maxAgeHours} hours.` : null,
    maxAgeHours,
    sources
  };
}

// Read the folder and summarize it. If no folder is configured the answer is
// "unknown", which never raises an alert (we can't judge what we can't see).
function readBackups(dir, nowMs, maxAgeHours, { fsModule = fs } = {}) {
  if (!dir) return { status: "unknown", detail: "BACKUP_DIR is not set.", maxAgeHours, sources: [] };

  let names;
  try {
    names = fsModule.readdirSync(dir);
  } catch (err) {
    return { status: "none", detail: `Backup folder can't be read (${err.code || err.message}).`, maxAgeHours, sources: [] };
  }

  const files = [];
  for (const name of names) {
    if (!parseBackupName(name)) continue;
    try {
      const stats = fsModule.statSync(path.join(dir, name));
      files.push({ name, size: stats.size, mtimeMs: stats.mtimeMs });
    } catch {
      // The file vanished between listing and reading (pruned): skip it.
    }
  }
  return summarizeBackups(files, nowMs, maxAgeHours);
}

module.exports = { parseBackupName, summarizeBackups, readBackups };
