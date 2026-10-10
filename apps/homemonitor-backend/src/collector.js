// Takes ONE complete reading of everything: the "snapshot".
//
// A snapshot looks like:
//   { at, system: { cpuPercent, memory, loadAverage, uptimeSeconds, network },
//     disks: [...], services: [...], registryError, backups }
//
// CPU and network speed need two readings to calculate (see readings.js), so
// the collector remembers the previous ones. That is why the first snapshot
// after startup has cpuPercent null.
//
// All the real-machine readers can be swapped for fakes (`readers`), which is
// how tests run the whole thing with made-up numbers.
const os = require("os");
const readings = require("./readings");
const { checkAllServices } = require("./services");
const { readBackups } = require("./backups");

function createCollector(config, overrides = {}) {
  const readers = {
    cpuTimes: () => readings.readCpuTimes(),
    memory: () => readings.readMemory(),
    network: () => readings.readNetworkCounters(),
    disk: (path) => readings.readDisk(path),
    loadAverage: () => os.loadavg(),
    uptimeSeconds: () => os.uptime(),
    services: () => checkAllServices(config),
    backups: (nowMs) => readBackups(config.backupDir, nowMs, config.backupMaxAgeHours),
    now: () => Date.now(),
    ...overrides
  };

  let previousCpu = null;
  let previousNetwork = null;

  async function collect() {
    const nowMs = readers.now();

    const cpuTimes = readers.cpuTimes();
    const cpuPercent = readings.cpuPercent(previousCpu, cpuTimes);
    previousCpu = cpuTimes;

    const networkCounters = readers.network();
    const network = readings.networkRate(previousNetwork, networkCounters);
    previousNetwork = networkCounters;

    // A disk we can't read is reported WITH its error (and later raises an
    // alert) instead of crashing the whole snapshot.
    const disks = config.diskPaths.map(({ label, path }) => {
      try {
        return { label, path, ...readers.disk(path) };
      } catch (err) {
        return { label, path, error: err.code || err.message };
      }
    });

    const { services, registryError } = await readers.services();

    return {
      at: new Date(nowMs).toISOString(),
      system: {
        cpuPercent,
        memory: readers.memory(),
        loadAverage: readers.loadAverage(),
        uptimeSeconds: readers.uptimeSeconds(),
        network
      },
      disks,
      services,
      registryError,
      backups: readers.backups(nowMs)
    };
  }

  return { collect };
}

module.exports = { createCollector };
