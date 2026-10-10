// All of HomeMonitor's settings, read from environment variables in ONE place.
//
// Every setting has a sensible default so the monitor runs with none of them
// set. loadConfig takes the environment as an argument (instead of reading
// process.env directly) so tests can pass in a made-up one.

// "a=http://x,b=http://y"  ->  { a: "http://x", b: "http://y" }
// Used for SERVICE_URLS. We use this plain format (rather than JSON) because
// the Windows dev launcher passes settings through a .bat file, where the
// double quotes JSON needs would break.
function parseKeyValueList(text) {
  const result = {};
  for (const part of String(text || "").split(",")) {
    const index = part.indexOf("=");
    if (index < 1) continue; // skip blanks and entries with no key
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key && value) result[key] = value;
  }
  return result;
}

// A positive number from the environment, or the fallback if it is missing,
// not a number, or not above zero.
function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function loadConfig(env = process.env) {
  // Which folders to measure for "disk used". Format "label=path,label=path".
  // Default: the monitor's own data folder, which in Docker lives on the same
  // disk as every other app's data volume.
  const diskEntries = parseKeyValueList(env.DISK_PATHS);
  if (Object.keys(diskEntries).length === 0) diskEntries.data = env.DATA_DIR || "/";

  return {
    // How often to take a reading, in seconds.
    intervalSeconds: Math.max(5, positiveNumber(env.MONITOR_INTERVAL_SECONDS, 30)),
    // How often to save a point of history (for the charts), in seconds.
    sampleEverySeconds: positiveNumber(env.SAMPLE_EVERY_SECONDS, 300),

    // HomeCore: where the app registry and notifications live, plus the
    // shared secret that proves we are a trusted Home service.
    homecoreUrl: (env.HOMECORE_INTERNAL_URL || "http://localhost:4000").replace(/\/$/, ""),
    internalSecret: env.HOMECORE_INTERNAL_SECRET || "",

    // Where to find each app's health endpoint. The gateway reaches them all
    // by path; SERVICE_URLS overrides that per app (used in dev, where there
    // is no gateway). With neither, a service shows as "unknown".
    gatewayUrl: (env.GATEWAY_URL || "").replace(/\/$/, ""),
    serviceUrls: parseKeyValueList(env.SERVICE_URLS),
    checkTimeoutMs: positiveNumber(env.CHECK_TIMEOUT_MS, 3000),

    diskPaths: Object.entries(diskEntries).map(([label, path]) => ({ label, path })),

    // Backups: the folder the backup service writes into (mounted read-only).
    backupDir: env.BACKUP_DIR || "",
    backupMaxAgeHours: positiveNumber(env.BACKUP_MAX_AGE_HOURS, 36),

    // Alerts.
    diskAlertPercent: positiveNumber(env.DISK_ALERT_PERCENT, 80),
    serviceDownChecks: Math.round(positiveNumber(env.SERVICE_DOWN_CHECKS, 2)), // failed checks in a row before alerting
    backupAlertChecks: Math.round(positiveNumber(env.BACKUP_ALERT_CHECKS, 20)), // generous: the first backup can take a while
    // Set ALERTS_ENABLED=false (the dev launcher does) to show alerts on screen
    // without sending any notifications.
    alertsEnabled: env.ALERTS_ENABLED !== "false"
  };
}

module.exports = { loadConfig, parseKeyValueList };
