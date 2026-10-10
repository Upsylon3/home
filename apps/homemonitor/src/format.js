// Turns raw numbers into the words and units shown on screen.
// Pure functions: easy to read and to test (test/format.test.js).

// 1536 -> "1.5 KB". null/undefined -> a dash ("no reading").
export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Whole bytes need no decimal; everything else gets one.
  return `${unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatRate(bytesPerSec) {
  return bytesPerSec === null || bytesPerSec === undefined ? "—" : `${formatBytes(bytesPerSec)}/s`;
}

// 93784 seconds -> "1 d 2 h". Shows the two biggest units, which is plenty.
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

// "How long ago": takes an ISO date string (or milliseconds) and "now" in ms.
export function formatAgo(when, nowMs = Date.now()) {
  const thenMs = typeof when === "number" ? when : Date.parse(when);
  if (!Number.isFinite(thenMs)) return "—";
  const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

// How worried to look about a percentage. The screen ALSO writes the word
// ("high", "critical"), so the meaning never depends on color alone.
export function meterTone(percent) {
  if (percent >= 95) return "critical";
  if (percent >= 80) return "high";
  return "ok";
}

// Status words for services (the lamp color is only a reinforcement).
export const SERVICE_STATUS = {
  up: { label: "Up", lamp: "healthy" },
  degraded: { label: "Degraded", lamp: "degraded" },
  down: { label: "Down", lamp: "unhealthy" },
  unknown: { label: "Unknown", lamp: "unknown" }
};

export const BACKUP_STATUS = {
  ok: "Up to date",
  stale: "Out of date",
  none: "No backups found",
  unknown: "Not configured"
};
