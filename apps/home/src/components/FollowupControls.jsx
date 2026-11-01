import { useEffect, useState } from "react";
import { api } from "../api.js";

const reasons = {
  "source-changed": "Monitor's identity changed. Review the current source and renew to confirm it.",
  "grant-expired": "Consent expired. Renew to continue.",
  "grant-refused": "Core refused this grant. Review your account and renew if appropriate.",
  "daily-limit": "Daily task limit reached. Delivery will retry after the limit resets.",
  "delivery-conflict": "A pending task needs attention. Restore the automation key if it changed, or review your tasks before retrying.",
  "credentials-unavailable": "Stored consent could not be recovered. Revoke the old grant below before renewing.",
  "upstream-unavailable": "A required service is unavailable or its readings are stale. No new task is dispatched until valid readings return.",
  "evaluation-not-newer": "Waiting for a newer Monitor evaluation.",
  "enrollment-failed": "Enrollment did not complete. Review your Core grants below.",
  "revocation-pending": "Stopping — revocation pending. New local dispatch is paused. Use direct Core revocation below if needed."
};
const time = value => value ? new Date(value).toLocaleString() : "Not yet";
export default function FollowupControls({ user }) {
  const [bridge, setBridge] = useState(null), [grants, setGrants] = useState([]);
  const [unavailable, setUnavailable] = useState(false), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [consent, setConsent] = useState(false);
  async function refresh() {
    const results = await Promise.allSettled([api.automation.status(), api.automation.grants()]);
    if (results[0].status === "fulfilled") { setBridge(results[0].value.data); setUnavailable(false); }
    else { setBridge(null); setUnavailable(true); }
    if (results[1].status === "fulfilled") setGrants(results[1].value.data.grants);
    else setError("Could not load Core grants. Refresh before assuming consent was revoked.");
  }
  useEffect(() => { refresh(); }, []);
  async function act(action) {
    setBusy(true); setError("");
    try { await action(); setConsent(false); }
    catch (e) { setError(e.message); }
    finally { await refresh(); setBusy(false); }
  }
  const rule = bridge?.rule;
  return <section className="panel" aria-labelledby="followup-title">
    <h3 className="panel-title" id="followup-title">Monitor follow-up tasks</h3>
    <p className="panel-desc">Optional background checks turn persistent critical HomeMonitor alerts into tasks in your own HomeTasks inbox.</p>
    <ul className="followup-terms">
      <li>Checks run every five minutes, even when your browser is closed.</li>
      <li>Four fresh critical observations spanning at least 15 minutes create one task per incident. Existing alerts can qualify.</li>
      <li>At most 20 new tasks per UTC day. No due dates, projects, recurrence or priority escalation.</li>
      <li>You manage tasks yourself. Recovery never edits, completes or deletes them. Completing or deleting a task prevents its recreation.</li>
      <li>Consent expires after 30 days. Normal sign-out does not stop checks; Disable, password change and Sign out everywhere do.</li>
    </ul>
    <div role="status" aria-live="polite">
      {unavailable ? <p>HomeBridge is unavailable. Core grants below remain independent.</p>
        : !bridge ? <p>Loading automation status…</p>
          : !bridge.configured ? <p>Automation is not configured on this server.</p>
            : <p>State: <strong>{rule?.status || "disabled"}</strong>. {reasons[rule?.reason] || ""}</p>}
      {rule && <dl className="followup-details">
        <dt>Consent expires</dt><dd>{time(rule.expiresAt)}</dd>
        <dt>Last successful check</dt><dd>{time(rule.lastSuccessAt)}</dd>
        <dt>Last task receipt</dt><dd>{time(rule.lastDeliveryAt)}</dd>
        <dt>Qualifying incidents</dt><dd>{rule.qualifyingIncidents}</dd>
        <dt>Pending deliveries</dt><dd>{rule.pendingDeliveries}</dd>
        {rule.retryAt && <><dt>Next eligible retry</dt><dd>{time(rule.retryAt)}</dd></>}
      </dl>}
    </div>
    {error && <p role="alert" className="error-banner">{error}</p>}
    {user.role === "admin" && <form onSubmit={e => { e.preventDefault(); if (consent) act(api.automation.enroll); }}>
      <label className="followup-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy || !bridge?.configured} />
        I consent to these background checks and task creation for my account, including any existing qualifying alerts. Renewing confirms the current Monitor source.</label>
      <div className="followup-actions">
        <button className="btn btn-primary" disabled={busy || !consent || !bridge?.configured} type="submit">{rule?.grantId ? "Renew / confirm current source" : "Enable follow-up tasks"}</button>
        {rule?.grantId && <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => act(api.automation.disable)}>Disable</button>}
      </div>
    </form>}
    {user.role !== "admin" && <p>Only administrators can enable follow-up tasks. You can still revoke your own grant.</p>}
    <h4>Core consent grants</h4>
    <p className="panel-desc">Direct revocation works when HomeBridge is unavailable. Already authorized requests can still finish; revocation does not undo an existing task.</p>
    {!grants.length && <p>No grants found.</p>}
    {grants.map(grant => <div className="followup-grant" key={grant.id}>
      <p>Monitor follow-up · {grant.status}<br />Expires {time(grant.expiresAt)}</p>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy || grant.status === "revoked"} onClick={() => act(() => api.automation.revoke(grant.id))}>Revoke directly in Core</button>
    </div>)}
    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(async () => {})}>Refresh status</button>
  </section>;
}
