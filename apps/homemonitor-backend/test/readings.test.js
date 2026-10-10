const { test } = require("node:test");
const assert = require("node:assert/strict");
const r = require("../src/readings");

const MEMINFO = `MemTotal:       16000000 kB
MemFree:         1000000 kB
MemAvailable:    8000000 kB
Buffers:          500000 kB
Cached:          4000000 kB
`;

test("parseMeminfo uses MemAvailable (not MemFree) for what's really free", () => {
  assert.deepEqual(r.parseMeminfo(MEMINFO), { totalBytes: 16000000 * 1024, availableBytes: 8000000 * 1024 });
});

test("parseMeminfo falls back to free + buffers + cached on old kernels", () => {
  const old = "MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 150 kB\n";
  assert.equal(r.parseMeminfo(old).availableBytes, 300 * 1024);
  assert.equal(r.parseMeminfo("garbage"), null);
});

test("readMemory computes used and percent, and falls back to Node's numbers off Linux", () => {
  const linux = r.readMemory({ readFile: () => MEMINFO });
  assert.equal(linux.percent, 50);
  assert.equal(linux.usedBytes, 8000000 * 1024);

  const other = r.readMemory({
    readFile: () => {
      throw new Error("ENOENT");
    },
    osModule: { totalmem: () => 1000, freemem: () => 250 }
  });
  assert.deepEqual(other, { totalBytes: 1000, usedBytes: 750, percent: 75 });
});

test("cpuPercent is the busy share between two readings, and null without an earlier one", () => {
  assert.equal(r.cpuPercent(null, { idle: 10, total: 20 }), null);
  assert.equal(r.cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 400 }), 75);
  assert.equal(r.cpuPercent({ idle: 100, total: 200 }, { idle: 100, total: 200 }), null); // no time passed
  assert.equal(r.cpuPercent({ idle: 100, total: 200 }, { idle: 300, total: 300 }), 0); // clamped, never negative
});

test("readCpuTimes adds up every core's modes, idle separately", () => {
  const osModule = {
    cpus: () => [
      { times: { user: 10, nice: 0, sys: 5, idle: 85, irq: 0 } },
      { times: { user: 20, nice: 0, sys: 10, idle: 70, irq: 0 } }
    ]
  };
  assert.deepEqual(r.readCpuTimes({ osModule }), { idle: 155, total: 200 });
});

const NETDEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0
  eth0: 5000 50 0 0 0 0 0 0 7000 40 0 0 0 0 0 0
  eth1: 100 1 0 0 0 0 0 0 200 1 0 0 0 0 0 0
`;

test("parseNetDev sums real interfaces and skips loopback", () => {
  assert.deepEqual(r.parseNetDev(NETDEV), { rxBytes: 5100, txBytes: 7200 });
  assert.equal(r.parseNetDev("nothing useful\nat all\n"), null);
});

test("networkRate gives bytes per second, and null when it can't be trusted", () => {
  const prev = { rxBytes: 1000, txBytes: 2000, at: 0 };
  assert.deepEqual(r.networkRate(prev, { rxBytes: 3000, txBytes: 2500, at: 2000 }), { rxBytesPerSec: 1000, txBytesPerSec: 250 });
  assert.equal(r.networkRate(null, prev), null);
  assert.equal(r.networkRate(prev, { rxBytes: 10, txBytes: 10, at: 5000 }), null); // counters reset
  assert.equal(r.networkRate(prev, { ...prev }), null); // no time passed
});

test("readDisk works out used percent the way df does", () => {
  const disk = r.readDisk("/x", { statfs: () => ({ blocks: 1000, bsize: 4096, bfree: 300, bavail: 250 }) });
  assert.equal(disk.totalBytes, 4096000);
  assert.equal(disk.usedBytes, 700 * 4096);
  assert.ok(Math.abs(disk.usedPercent - (700 / 950) * 100) < 1e-9);
  assert.equal(r.readDisk("/x", { statfs: () => ({ blocks: 0, bsize: 4096, bfree: 0, bavail: 0 }) }).usedPercent, 0);
});
