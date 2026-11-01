// The orchestrator: one "tick" = take a snapshot, save history, check the alert
// rules, commit alert state/freshness and notification intent, then deliver.
//
// server.js runs tick() on a timer. Tests call tick() by hand with fake parts,
// which is why the parts are passed in rather than imported here.
const { buildConditions, evaluateAlerts } = require("./alerts");

function createMonitor({ config, collector, history, notifier, now = Date.now }) {
  let latest = null;
  let ticking = false;
  let lastSampleSeconds = 0;
  let lastNotifyError = null;

  async function tick() {
    // If a slow reading is still running when the next timer fires, don't pile
    // a second one on top of it.
    if (ticking) return latest;
    ticking = true;
    try {
      const snapshot = await collector.collect();
      latest = snapshot;

      const nowSeconds = Math.floor(now() / 1000);
      const today = snapshot.at.slice(0, 10);

      // History is saved every few minutes, not on every tick.
      if (nowSeconds - lastSampleSeconds >= config.sampleEverySeconds) {
        history.recordSample(nowSeconds, snapshot);
        history.recordDiskDaily(today, snapshot.disks);
        history.prune(nowSeconds, today);
        lastSampleSeconds = nowSeconds;
      }

      const conditions = buildConditions(snapshot, config);
      const previous = history.loadAlertState();
      const { next, notify } = evaluateAlerts(conditions, previous, snapshot.at);

      let evaluationError;
      try { history.commitEvaluation(next, snapshot.at, config.alertsEnabled ? notify : []); }
      catch (error) { evaluationError = error; }
      // Even a saturated queue must be drained. Otherwise a new transition
      // could repeatedly fail its commit and prevent delivery forever.
      const pending = config.alertsEnabled ? history.pendingNotifications() : [];
      if (pending.length > 0) {
        try {
          await notifier(pending.map(item => item.payload));
          history.acknowledgeNotifications(pending.map(item => item.id));
          lastNotifyError = null;
        } catch (err) {
          // Fresh state remains committed; durable notification intent is
          // retried separately, including after a restart or later resolution.
          lastNotifyError = err.message;
          console.error(`[homemonitor] couldn't send notifications, will retry: ${err.message}`);
        }
      }

      if (evaluationError) throw evaluationError;
      return snapshot;
    } finally {
      ticking = false;
    }
  }

  // What the screen shows: the latest snapshot plus the active alerts.
  async function getStatus() {
    if (!latest) await tick(); // first request before the first timer tick
    const state = history.loadAlertState();
    const alerts = Object.entries(state)
      .filter(([, s]) => s.active)
      .map(([key, s]) => ({ key, severity: s.severity, title: s.title, body: s.body, since: s.since }))
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
    return { ...latest, alerts, alertsEnabled: config.alertsEnabled, notifyError: lastNotifyError };
  }

  return { tick, getStatus };
}

module.exports = { createMonitor };
