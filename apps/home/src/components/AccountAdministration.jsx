import { useEffect, useState } from "react";
import { api } from "../api.js";

function formatStorage(bytes) {
  return bytes == null ? "Unavailable" : (bytes / (1024 ** 3)).toFixed(2) + " GB";
}

export default function AccountAdministration({ currentUserId }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    const { data } = await api.accountAdmin.users();
    setUsers(data.users);
  }
  async function retry() {
    setError("");
    try { await refresh(); } catch (err) { setError(err.message); }
  }
  useEffect(() => { refresh().catch(err => setError(err.message)); }, []);

  async function act(id, operation) {
    setError("");
    setNotice("");
    setBusy(id);
    try { await operation(); await refresh(); }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  async function resetPassword(e) {
    e.preventDefault();
    if (busy !== null || !resetTarget) return;
    if (!window.confirm("Reset " + resetTarget.username + "'s password and revoke their sessions?")) return;
    await act(resetTarget.id, async () => {
      await api.accountAdmin.resetPassword(resetTarget.id, newPassword);
      setNewPassword("");
      setResetTarget(null);
      setNotice("Password reset. This account's existing sessions have been signed out.");
    });
  }

  function setQuota(u) {
    const value = window.prompt("Storage quota in GB for " + u.username + ". Blank resets to the default.", String(u.quotaBytes / 1024 ** 3));
    if (value === null) return;
    const trimmed = value.trim();
    const gb = Number(trimmed);
    if (trimmed && (!Number.isFinite(gb) || gb <= 0)) { setError("Enter a positive storage quota."); return; }
    const bytes = Math.round(gb * 1024 ** 3);
    if (trimmed && (!Number.isSafeInteger(bytes) || bytes <= 0)) { setError("Enter a quota between 1 byte and the maximum safe storage size."); return; }
    act(u.id, () => api.accountAdmin.setQuota(u.id, trimmed ? bytes : null));
  }

  return (
    <section className="panel account-administration" aria-labelledby="home-admin-heading">
      <h3 id="home-admin-heading" className="panel-title">Account administration</h3>
      <p className="panel-desc">Manage HOME accounts through HomeCore. Storage usage is reported by HomeCloud.</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {resetTarget && <form onSubmit={resetPassword} aria-label={`Reset password for ${resetTarget.username}`}>
        <p>Reset password for <strong>{resetTarget.username}</strong>. Existing sessions will be signed out.</p>
        <div className="field">
          <label htmlFor="home-admin-password">New account password</label>
          <input id="home-admin-password" type="password" autoComplete="new-password" required minLength={8}
            value={newPassword} disabled={busy !== null} onChange={e => setNewPassword(e.target.value)} />
        </div>
        <button className="btn btn-primary btn-sm" disabled={busy !== null}>Reset password and sign out sessions</button>
        <button className="btn btn-ghost btn-sm" type="button" disabled={busy !== null} onClick={() => { setResetTarget(null); setNewPassword(""); }}>Cancel reset</button>
      </form>}
      {users === null ? error ? <button className="btn btn-ghost btn-sm" onClick={retry}>Retry</button> : <p>Loading accounts…</p> : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Account</th><th>Role</th><th>Status</th><th>2FA</th><th>Storage used / quota</th><th>Actions</th></tr></thead>
            <tbody>{users.map(u => (
              <tr key={u.id}>
                <td>{u.username}</td><td>{u.role}</td><td>{u.disabled ? "Disabled" : "Active"}</td>
                <td>{u.totpEnabled ? "Enabled" : "Off"}</td>
                <td>{formatStorage(u.usedBytes)} / {formatStorage(u.quotaBytes)}</td>
                <td>
                  <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => { setResetTarget(u); setNewPassword(""); setError(""); setNotice(""); }}>Reset password</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => setQuota(u)}>Set quota</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => {
                    const role = u.role === "admin" ? "user" : "admin";
                    if (window.confirm("Change " + u.username + "'s role to " + role + "?")) act(u.id, () => api.accountAdmin.setRole(u.id, role));
                  }}>{u.role === "admin" ? "Remove admin" : "Make admin"}</button>
                  {u.totpEnabled && <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => {
                    if (window.confirm("Only proceed after verifying " + u.username + "'s identity independently. Disable their 2FA?")) act(u.id, () => api.accountAdmin.disable2fa(u.id));
                  }}>Reset 2FA</button>}
                  <button className="btn btn-danger-ghost" disabled={busy !== null || String(u.id) === String(currentUserId)} onClick={() => {
                    const disabled = !u.disabled;
                    if (window.confirm((disabled ? "Disable" : "Enable") + " account " + u.username + "?")) act(u.id, () => api.accountAdmin.setDisabled(u.id, disabled));
                  }}>{u.disabled ? "Enable" : "Disable"}</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
