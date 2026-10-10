const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig, parseKeyValueList } = require("../src/config");

test("parseKeyValueList reads 'a=b,c=d' and ignores junk", () => {
  assert.deepEqual(parseKeyValueList("a=http://x:1,b=http://y:2"), { a: "http://x:1", b: "http://y:2" });
  assert.deepEqual(parseKeyValueList(" a = 1 , ,=nokey,novalue=,b=2 "), { a: "1", b: "2" });
  assert.deepEqual(parseKeyValueList(undefined), {});
});

test("everything has a sensible default", () => {
  const config = loadConfig({ DATA_DIR: "/data" });
  assert.equal(config.intervalSeconds, 30);
  assert.equal(config.diskAlertPercent, 80);
  assert.equal(config.serviceDownChecks, 2);
  assert.equal(config.alertsEnabled, true);
  assert.equal(config.homecoreUrl, "http://localhost:4000");
  assert.deepEqual(config.diskPaths, [{ label: "data", path: "/data" }]); // defaults to the monitor's own data folder
  assert.equal(config.gatewayUrl, "");
});

test("settings are read, trailing slashes trimmed, and bad numbers fall back", () => {
  const config = loadConfig({
    MONITOR_INTERVAL_SECONDS: "60",
    DISK_ALERT_PERCENT: "90",
    DISK_PATHS: "data=/data,backups=/backups",
    GATEWAY_URL: "http://gateway/",
    HOMECORE_INTERNAL_URL: "http://homecore:4000/",
    SERVICE_DOWN_CHECKS: "banana",
    ALERTS_ENABLED: "false"
  });
  assert.equal(config.intervalSeconds, 60);
  assert.equal(config.diskAlertPercent, 90);
  assert.deepEqual(config.diskPaths, [
    { label: "data", path: "/data" },
    { label: "backups", path: "/backups" }
  ]);
  assert.equal(config.gatewayUrl, "http://gateway");
  assert.equal(config.homecoreUrl, "http://homecore:4000");
  assert.equal(config.serviceDownChecks, 2); // "banana" is not a number: default
  assert.equal(config.alertsEnabled, false);
});

test("the interval can't be set dangerously low", () => {
  assert.equal(loadConfig({ MONITOR_INTERVAL_SECONDS: "1" }).intervalSeconds, 5);
});
