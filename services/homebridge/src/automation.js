const crypto = require("node:crypto");
const { origin, getJSON } = require("./upstream");
const { INTEGRATION, UUID } = require("./automationStore");
const POLL_MS = 300000;
const problem = (status, message) => Object.assign(new Error(message), { status });
function validateFeed(feed, at) {
  if (!feed || !UUID.test(feed.instanceId) || typeof feed.evaluatedAt !== "string" ||
      !Number.isFinite(Date.parse(feed.evaluatedAt)) || at - Date.parse(feed.evaluatedAt) > 120000 || Date.parse(feed.evaluatedAt) - at > 30000 ||
      !Array.isArray(feed.conditions) || feed.conditions.length > 256) throw problem(502, "Monitor evaluation is unavailable or stale.");
  const keys = new Set(), incidents = new Set();
  for (const c of feed.conditions) {
    if (!c || typeof c.key !== "string" || !c.key || c.key.length > 256 || keys.has(c.key) ||
        !["active", "pending", "resolved", "unknown"].includes(c.state) || !["warning", "critical"].includes(c.severity) ||
        typeof c.title !== "string" || c.title.length > 200 || /[\x00-\x1f\x7f]/.test(c.title) ||
        (c.incidentId !== null && (!UUID.test(c.incidentId) || incidents.has(c.incidentId))) ||
        (c.state === "active" && (!c.incidentId || !Number.isFinite(Date.parse(c.openedAt)) || Date.parse(c.openedAt) > Date.parse(feed.evaluatedAt))) ||
        (c.openedAt !== null && !Number.isFinite(Date.parse(c.openedAt)))) throw problem(502, "Monitor returned invalid condition metadata.");
    keys.add(c.key); if (c.incidentId) incidents.add(c.incidentId);
  }
  return feed;
}
function validateIssued(issued, subject, at) {
  if (!issued?.grant || !UUID.test(issued.grant.id) || issued.grant.subjectUserId !== subject ||
      issued.grant.integrationId !== INTEGRATION || issued.grant.status !== "active" ||
      !Number.isFinite(Date.parse(issued.grant.expiresAt)) || Date.parse(issued.grant.expiresAt) <= at ||
      !Array.isArray(issued.capabilities) || issued.capabilities.length !== 2) throw problem(502, "Core returned invalid grant metadata.");
  for (const [audience, action] of [["homemonitor", "monitor.alerts.read"], ["hometasks", "tasks.automation.create-once"]]) {
    const caps = issued.capabilities.filter(c => c.audience === audience && c.action === action && /^hc_dg_[A-Za-z0-9_-]{43}$/.test(c.token));
    if (caps.length !== 1) throw problem(502, "Core returned invalid capabilities.");
  }
  return issued;
}
function createAutomation({ store, homecoreUrl, monitorUrl, tasksUrl, now = Date.now, request = getJSON }) {
  const core = origin(homecoreUrl), monitor = origin(monitorUrl), tasks = origin(tasksUrl);
  let running = false;
  let stopped = false;
  // Four rule cycles globally, so at most four action requests are in flight.
  let active = 0; const waiting = [];
  async function slot(action) {
    if (active >= 4) await new Promise(resolve => waiting.push(resolve));
    else active++;
    try { return await action(); } finally { if (waiting.length) waiting.shift()(); else active--; }
  }
  const call = (url, token, options = {}) => request(url, token, { maxBytes: 256 * 1024, timeoutMs: 5000, ...options });
  const feed = async token => validateFeed(await call(`${monitor}/api/homemonitor/automation/alerts`, token), now());
  const pause = (subject, reason, status = "paused") => store.update(subject, { enabled: 0, status, reason, qualification: "{}" });
  async function surrender(subject) {
    const row = store.get(subject); if (!row?.grant_id) { store.update(subject, { revocation_pending: 0, status: "disabled" }); return; }
    try {
      const tokens = store.credentials(row);
      await call(`${core}/api/core/delegations/surrender`, tokens.homemonitor, { method: "POST", body: {} });
      // Never erase a more recent enrollment's credentials.
      const current = store.get(subject);
      if (current.revision === row.revision && !current.enabled) store.update(subject, {
        revocation_pending: 0, status: "disabled", reason: null, monitor_cipher: null, tasks_cipher: null });
    } catch {
      const current = store.get(subject);
      if (current.revision === row.revision && !current.enabled) store.update(subject, { revocation_pending: 1, status: "stopping", reason: "revocation-pending" });
    }
  }
  async function disable(subject) {
    const row = store.ensure(subject);
    store.update(subject, { enabled: 0, revision: row.revision + 1, revocation_pending: row.grant_id ? 1 : 0,
      status: "stopping", qualification: "{}", reason: "revocation-pending" });
    await surrender(subject); return store.view(subject);
  }
  async function enroll(subject, token) {
    const { revision, claim } = store.begin(subject, now());
    const enrollmentOwner = crypto.randomUUID();
    let issued;
    try {
      if (!store.lease(subject, enrollmentOwner, now())) throw problem(409, "Automation is busy. Try again shortly.");
      const listed = await call(`${core}/api/core/delegations`, token);
      if (!Array.isArray(listed?.grants)) throw problem(502, "Core grant list is unavailable.");
      const existing = listed.grants.find(g => g.integrationId === INTEGRATION);
      const route = existing ? `/internal/delegations/${encodeURIComponent(existing.id)}/renew` : "/internal/delegations";
      issued = validateIssued(await call(`${core}${route}`, token, { method: "POST",
        body: existing ? { consent: true } : { integrationId: INTEGRATION, consent: true } }), subject, now());
      // Persist disabled and encrypted before any validation or activation.
      const installed = store.install(subject, issued, null, revision, claim);
      if (!installed) {
        await call(`${core}/api/core/delegations/surrender`, issued.capabilities[0].token, { method: "POST", body: {} });
        const current = store.get(subject);
        if (current.control_until === claim && !current.enabled) await surrender(subject);
        return store.view(subject);
      }
      const currentFeed = await feed(issued.capabilities.find(c => c.audience === "homemonitor").token);
      const row = store.get(subject);
      if (row.revision !== revision || row.control_until !== claim) { await surrender(subject); return store.view(subject); }
      store.update(subject, { enabled: 1, status: "enabled", reason: null, instance_id: currentFeed.instanceId,
        qualification: "{}", last_evaluation: null, last_success: now(), revocation_pending: 0 });
      return store.view(subject);
    } catch (error) {
      if (issued) {
        try { await call(`${core}/api/core/delegations/surrender`, issued.capabilities[0].token, { method: "POST", body: {} }); }
        catch { const row = store.get(subject); if (row?.grant_id === issued.grant.id) store.update(subject, { revocation_pending: 1, status: "stopping" }); }
      }
      const row = store.get(subject);
      if (!row.revocation_pending) pause(subject, "enrollment-failed");
      throw problem([401, 403, 409].includes(error.status) ? error.status : 502, "Could not enable follow-up tasks. Check Core grants and try again.");
    } finally { store.endControl(subject, claim); store.release(subject, enrollmentOwner); }
  }
  function resetOnStart() {
    // Incomplete qualification never survives a worker restart. Pending
    // canonical delivery intent and receipt metadata do survive.
    store.db.prepare("UPDATE bridge_rules SET qualification = '{}', last_evaluation = NULL").run();
    store.recoverEnrollments(now());
    for (const { subject } of store.rules()) {
      const row = store.get(subject);
      try { store.credentials(row); } catch { pause(subject, "credentials-unavailable"); }
    }
  }
  async function runRule(subject) {
    return slot(async () => {
      if (stopped) return;
      const owner = crypto.randomUUID();
      if (!store.lease(subject, owner, now())) return;
      let row = store.get(subject);
      try {
        if (row.revocation_pending) { await surrender(subject); return; }
        if (!row.enabled || row.retry_at > now()) return;
        if (Date.parse(row.expires_at) <= now()) { pause(subject, "grant-expired"); return; }
        const tokens = store.credentials(row);
        store.update(subject, { last_checked: now() });
        const snapshot = await feed(tokens.homemonitor);
        if (!store.current(subject, row.revision, owner, now())) return;
        if (snapshot.instanceId !== row.instance_id) { pause(subject, "source-changed"); return; }
        const evaluated = Date.parse(snapshot.evaluatedAt), previous = Date.parse(row.last_evaluation);
        if (Number.isFinite(previous) && evaluated <= previous) {
          store.update(subject, { qualification: "{}", reason: "evaluation-not-newer" }); return;
        }
        const updated = store.db.transaction(() => {
          if (!store.current(subject, row.revision, owner, now())) return false;
          const old = JSON.parse(row.qualification), next = {};
          for (const condition of snapshot.conditions) {
            if (condition.incidentId && condition.state === "resolved") store.finish(row, condition.incidentId, "resolved");
            if (condition.state !== "active" || condition.severity !== "critical") continue;
            const seen = store.findIntent(row, condition.incidentId);
            if (seen) continue;
            const prior = old[condition.incidentId];
            const continuous = prior && evaluated - prior.last <= 600000 && evaluated > prior.last;
            const observation = continuous ? { first: prior.first, last: evaluated, count: prior.count + 1 }
              : { first: evaluated, last: evaluated, count: 1 };
            next[condition.incidentId] = observation;
            if (observation.count >= 4 && evaluated - observation.first >= 900000) {
              const title = `Review HomeMonitor alert: ${condition.title}`.slice(0, 200).trim();
              store.intent(row, condition.incidentId, { title,
                notes: `Source: HomeMonitor\nIncident opened: ${condition.openedAt}\n/monitor/` });
              delete next[condition.incidentId];
            }
          }
          store.update(subject, { qualification: JSON.stringify(next), last_evaluation: snapshot.evaluatedAt,
            last_success: now(), reason: null, status: "enabled", retry_at: 0 });
          return true;
          }).immediate();
        if (!updated) return;
        const eligible = snapshot.conditions.filter(c => c.state === "active" && c.severity === "critical")
          .map(c => store.findIntent(row, c.incidentId)).filter(intent => intent?.state === "pending").slice(0, 4);
        for (const pending of eligible) {
          // Every new write/retry requires another fresh source read. A
          // duplicate evaluation can validate an already-qualified intent.
          const fresh = await feed(tokens.homemonitor);
          if (!store.current(subject, row.revision, owner, now())) return;
          if (fresh.instanceId !== row.instance_id) { pause(subject, "source-changed"); return; }
          const condition = fresh.conditions.find(c => c.incidentId === pending.incident_id);
          if (condition?.state === "resolved") { store.finish(row, pending.incident_id, "resolved"); continue; }
          if (!condition || condition.state !== "active" || condition.severity !== "critical" ||
              Date.parse(fresh.evaluatedAt) < evaluated) continue;
          let payload;
          try { payload = store.decrypt(row, `intent:${row.instance_id}:${pending.incident_id}`, pending.payload_cipher); }
          catch { throw problem(409, "Pending delivery cannot be recovered."); }
          if (stopped || !store.current(subject, row.revision, owner, now())) return;
          const result = await call(`${tasks}/api/hometasks/automation/tasks`, tokens.hometasks, { method: "POST", body: payload });
          const receipt = result?.receipt;
          if (!receipt || !UUID.test(receipt.id) || !Number.isSafeInteger(receipt.taskId) || receipt.taskId < 1 ||
              !["active", "retired"].includes(receipt.state)) throw problem(502, "Invalid task receipt.");
          store.finish(row, pending.incident_id, "delivered", receipt);
          store.update(subject, { last_delivery: now() });
        }
      } catch (error) {
        if (!store.current(subject, row.revision, owner, now())) return;
        if ([401, 403].includes(error.status)) pause(subject, "grant-refused");
        else if ([400, 409].includes(error.status)) pause(subject, "delivery-conflict", "attention");
        else store.update(subject, { qualification: "{}", reason: error.status === 429 ? "daily-limit" : "upstream-unavailable",
          retry_at: now() + Math.max(POLL_MS, (error.retryAfter || 0) * 1000) });
      } finally { store.release(subject, owner); }
    });
  }
  async function tick() {
    if (running) return;
    running = true;
    try { store.recoverEnrollments(now()); await Promise.all(store.rules().map(({ subject }) => runRule(subject))); } finally { running = false; }
  }
  resetOnStart();
  return { enroll, disable, runRule, tick, stop: () => { stopped = true; }, status: subject => ({ configured: true, rule: store.view(subject) }) };
}
module.exports = { createAutomation, validateFeed, validateIssued, POLL_MS };
