// Raw system readings: CPU, memory, network and disk.
//
// Split in two on purpose:
//   * "parse" and "calculate" functions are PURE (text in, numbers out), so
//     they are tested with sample text; no real server needed.
//   * "read" functions touch the real machine (/proc files, statfs). They are
//     thin wrappers, and the collector lets tests swap them for fakes.
//
// Linux-specific parts (/proc/...) degrade gracefully: on Windows or macOS (or
// Docker Desktop on them) a missing file just means "no reading", never a crash.
const fs = require("fs");
const os = require("os");

// ---------- memory ----------

// /proc/meminfo looks like "MemTotal:       16318412 kB" per line. The number we
// want is MemAvailable ("how much could be used without swapping"), NOT
// MemFree: Linux fills spare RAM with disk cache, which it hands back the
// instant a program asks, so MemFree makes a healthy machine look nearly full.
function parseMeminfo(text) {
  const kb = {};
  for (const line of String(text).split("\n")) {
    const match = line.match(/^(\w+):\s+(\d+)\s*kB/);
    if (match) kb[match[1]] = Number(match[2]);
  }
  if (!kb.MemTotal) return null;
  const available = kb.MemAvailable ?? (kb.MemFree ?? 0) + (kb.Buffers ?? 0) + (kb.Cached ?? 0);
  return { totalBytes: kb.MemTotal * 1024, availableBytes: available * 1024 };
}

function readMemory({ readFile = fs.readFileSync, osModule = os } = {}) {
  let parsed = null;
  try {
    parsed = parseMeminfo(readFile("/proc/meminfo", "utf8"));
  } catch {
    // Not Linux, or /proc isn't visible: fall back to Node's own numbers.
  }
  const totalBytes = parsed ? parsed.totalBytes : osModule.totalmem();
  const availableBytes = parsed ? parsed.availableBytes : osModule.freemem();
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  return { totalBytes, usedBytes, percent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0 };
}

// ---------- CPU ----------

// Node reports, per core, how many milliseconds it spent in each mode since
// boot. Those counters only ever grow, so "how busy is the CPU right now"
// means comparing TWO readings: the share of the time between them that was
// not idle. That is why the very first reading has no percentage.
function readCpuTimes({ osModule = os } = {}) {
  let idle = 0;
  let total = 0;
  for (const cpu of osModule.cpus()) {
    for (const [mode, ms] of Object.entries(cpu.times)) {
      total += ms;
      if (mode === "idle") idle += ms;
    }
  }
  return { idle, total };
}

function cpuPercent(previous, current) {
  if (!previous) return null;
  const totalDelta = current.total - previous.total;
  if (totalDelta <= 0) return null;
  const idleDelta = current.idle - previous.idle;
  const busy = (1 - idleDelta / totalDelta) * 100;
  return Math.round(Math.min(100, Math.max(0, busy)) * 10) / 10; // one decimal, kept within 0-100
}

// ---------- network ----------

// /proc/net/dev: two header lines, then one line per interface:
//   "  eth0: 123456 789 0 0 0 0 0 0 654321 ..." (receive bytes first, then
//   after 8 receive columns, transmit bytes). We add up every interface except
//   the loopback "lo", which is just the machine talking to itself.
function parseNetDev(text) {
  let rxBytes = 0;
  let txBytes = 0;
  let interfaces = 0;
  for (const line of String(text).split("\n").slice(2)) {
    const [name, rest] = line.split(":");
    if (!rest || name.trim() === "lo") continue;
    const columns = rest.trim().split(/\s+/).map(Number);
    if (columns.length < 9 || columns.some(Number.isNaN)) continue;
    rxBytes += columns[0];
    txBytes += columns[8];
    interfaces += 1;
  }
  return interfaces > 0 ? { rxBytes, txBytes } : null;
}

function readNetworkCounters({ readFile = fs.readFileSync, now = Date.now } = {}) {
  try {
    const counters = parseNetDev(readFile("/proc/net/dev", "utf8"));
    return counters ? { ...counters, at: now() } : null;
  } catch {
    return null; // not Linux
  }
}

// Bytes per second between two counter readings. null if there is no earlier
// reading, no time passed, or a counter went DOWN (the interface was reset).
function networkRate(previous, current) {
  if (!previous || !current) return null;
  const seconds = (current.at - previous.at) / 1000;
  if (seconds <= 0 || current.rxBytes < previous.rxBytes || current.txBytes < previous.txBytes) return null;
  return {
    rxBytesPerSec: (current.rxBytes - previous.rxBytes) / seconds,
    txBytesPerSec: (current.txBytes - previous.txBytes) / seconds
  };
}

// ---------- disk ----------

// How full is the filesystem that holds `path`? Calculated the way the `df`
// command does it: used / (used + available to normal programs), so the few
// percent Linux keeps reserved for the system doesn't distort the figure.
function readDisk(path, { statfs = fs.statfsSync } = {}) {
  const stats = statfs(path);
  const totalBytes = stats.blocks * stats.bsize;
  const usedBytes = (stats.blocks - stats.bfree) * stats.bsize;
  const availableBytes = stats.bavail * stats.bsize;
  const denominator = usedBytes + availableBytes;
  return { totalBytes, usedBytes, usedPercent: denominator > 0 ? (usedBytes / denominator) * 100 : 0 };
}

module.exports = {
  parseMeminfo,
  readMemory,
  readCpuTimes,
  cpuPercent,
  parseNetDev,
  readNetworkCounters,
  networkRate,
  readDisk
};
