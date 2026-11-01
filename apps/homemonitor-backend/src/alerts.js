// WHEN do we raise an alert, and when do we say it's resolved?
//
// No database or network here; incident IDs are random when an alert opens:
//   buildConditions(snapshot, config)  -> the things we're watching, each
//                                         marked failing or fine right now
//   evaluateAlerts(conditions, previous, nowIso)
//                                       -> which alerts are active, and which
//                                         notifications to send
//
// The two things that stop alert spam:
//  1. A problem must persist for `minChecks` readings in a row before we
//     alert. One failed health check is a blip; two in a row is a problem.
//  2. We notify only when an alert OPENS and when it RESOLVES, never on every
//     reading in between. Disk alerts also have a margin: an alert at 80%
//     only resolves below 77%, so a disk hovering around 80% doesn't flap.
const { formatBytes } = require("./format");
const { randomUUID } = require("node:crypto");

const DISK_RESOLVE_MARGIN = 3; // percentage points below the threshold

// A "condition" is one thing being watched:
//   key        unique id, e.g. "disk:data" or "service:hometasks"
//   failing    is it bad right now?
//   clear      is it definitely fine again? (an active alert only resolves when this is true)
//   minChecks  how many failing readings in a row before it becomes an alert
//   severity   "warning" or "critical"
//   title/body words for the notification and the screen
function buildConditions(snapshot, config) {
  const conditions = [];

  for (const disk of snapshot.disks) {
    if (disk.error) {
      conditions.push({
        key: `disk-read:${disk.label}`,
        failing: true,
        clear: false,
        minChecks: 2,
        severity: "warning",
        title: `Can't read disk "${disk.label}"`,
        body: disk.error
      });
      continue;
    }
    const percent = disk.usedPercent;
    conditions.push({ key: `disk-read:${disk.label}`, failing: false, clear: true, minChecks: 2,
      severity: "warning", title: `Can't read disk "${disk.label}"`, body: "" });
    conditions.push({
      key: `disk:${disk.label}`,
      failing: percent >= config.diskAlertPercent,
      clear: percent < config.diskAlertPercent - DISK_RESOLVE_MARGIN,
      unknown: !Number.isFinite(percent),
      minChecks: 2,
      severity: percent >= 95 ? "critical" : "warning",
      title: `Disk "${disk.label}" is ${Math.round(percent)}% full`,
      body: `${formatBytes(disk.usedBytes)} of ${formatBytes(disk.totalBytes)} used. The alert level is ${config.diskAlertPercent}%.`
    });
  }

  for (const service of snapshot.services) {
    const down = service.status === "down"; // "unknown" and "degraded" are shown on screen but don't alert
    conditions.push({
      key: `service:${service.slug}`,
      failing: down,
      clear: service.status === "up" || service.status === "degraded",
      unknown: !["up", "degraded", "down"].includes(service.status),
      minChecks: config.serviceDownChecks,
      severity: "critical",
      title: `${service.name} is not responding`,
      body: service.detail || "The health check failed."
    });
  }

  const backups = snapshot.backups;
  const backupBad = backups.status === "stale" || backups.status === "none";
  conditions.push({
    key: "backup",
    failing: backupBad,
    clear: backups.status === "ok",
    unknown: !["ok", "stale", "none"].includes(backups.status),
    minChecks: config.backupAlertChecks,
    severity: "warning",
    title: backups.status === "none" ? "No backups found" : "Backups are out of date",
    body: backups.detail || ""
  });

  return conditions;
}

// previous: { [key]: { active, checks, since, incidentId, state, title, body, severity } }
// Returns { next, notify }: the new state to save, and notifications to send.
function evaluateAlerts(conditions, previous, nowIso) {
  const next = {};
  const notify = [];

  for (const condition of conditions) {
    const before = previous[condition.key] || { active: false, checks: 0, since: null };
    const shown = { title: condition.title, body: condition.body, severity: condition.severity };
    const identity = { incidentId: before.incidentId || null, since: before.since };

    if (condition.unknown) {
      next[condition.key] = { ...before, ...identity, checks: before.active ? before.checks : 0, ...shown, state: "unknown" };
      continue;
    }

    if (before.active) {
      if (condition.clear) {
        // Positive clear ends the incident. Keep its identity for the feed
        // until this condition opens a genuinely new incident.
        notify.push({
          key: condition.key,
          kind: "resolved",
          severity: "info",
          title: `Resolved: ${before.title}`,
          body: "Back to normal."
        });
        next[condition.key] = { active: false, checks: 0, ...identity, ...shown, state: "resolved" };
      } else {
        // Still active (or in the hysteresis zone): keep it, with fresh wording.
        next[condition.key] = { active: true, checks: before.checks, ...identity, ...shown, state: "active" };
      }
    } else if (condition.failing) {
      const checks = before.checks + 1;
      if (checks >= condition.minChecks) {
        next[condition.key] = { active: true, checks, since: nowIso, incidentId: randomUUID(), ...shown, state: "active" };
        notify.push({ key: condition.key, kind: "opened", ...shown });
      } else {
        // Failing, but not for long enough yet: count it, don't alert.
        next[condition.key] = { active: false, checks, since: null, incidentId: null, ...shown, state: "pending" };
      }
    }
    else {
      next[condition.key] = { active: false, checks: 0, ...identity, ...shown,
        state: condition.clear ? "resolved" : "pending" };
    }
  }
  // Missing evidence never proves recovery. Preserve open incidents through
  // registry outages, removed targets and unreadable disks, with unknown state.
  for (const [key, before] of Object.entries(previous)) {
    if (!Object.hasOwn(next, key) && before.active) next[key] = { ...before, state: "unknown" };
  }

  return { next, notify };
}

module.exports = { buildConditions, evaluateAlerts, DISK_RESOLVE_MARGIN };
