import { useEffect, useState } from "react";
import { api } from "../api.js";

function formatStorage(bytes) {
  return bytes == null ? "Unavailable" : (bytes / (1024 ** 3)).toFixed(2) + " GB";
}

export default function AccountAdministration({ currentUserId }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);

  async function refresh() {
    const { data } = await api.accountAdmin.users();
    setUsers(data.users);
  }
  useEffect(() => { refresh().catch(err => setError(err.message)); }, []);

  async function act(id, operation) {
    setError("");
    setBusy(id);
    try { await operation(); await refresh(); }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  function resetPassword(u) {
    const value = window.prompt("Set a temporary password for " + u.username + " (at least 8 characters):");
    if (value === null) return;
    if (value.length < 8) { setError("Password must contain at least 8 characters."); return; }
    if (!window.confirm("Reset " + u.username + "'s password and revoke their sessions?")) return;
    act(u.id, () => api.accountAdmin.resetPassword(u.id, value));
  }

  function setQuota(u) {
    const value = window.prompt("Storage quota in GB for " + u.username + ". Blank resets to the default.", String((u.quotaBytes / 1024 ** 3).toFixed(2)));
    if (value === null) return;
    const trimmed = value.trim();
    const gb = Number(trimmed);
    if (trimmed && (!Number.isFinite(gb) || gb <= 0)) { setError("Enter a positive storage quota."); return; }
    act(u.id, () => api.accountAdmin.setQuota(u.id, trimmed ? Math.round(gb * 1024 ** 3) : null));
  }

  return (
    <div className="panel">
      <h3 className="panel-title">Account administration</h3>
      <p className="panel-desc">Manage HOME accounts through HomeCore. Storage usage is reported by HomeCloud.</p>
      {error && <p role="alert">{error}</p>}
      {users === null ? <p>Loading accounts…</p> : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Account</th><th>Role</th><th>Status</th><th>2FA</th><th>Storage used / quota</th><th>Actions</th></tr></thead>
            <tbody>{users.map(u => (
              <tr key={u.id}>
                <td>{u.username}</td><td>{u.role}</td><td>{u.disabled ? "Disabled" : "Active"}</td>
                <td>{u.totpEnabled ? "Enabled" : "Off"}</td>
                <td>{formatStorage(u.usedBytes)} / {formatStorage(u.quotaBytes)}</td>
                <td>
                  <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => resetPassword(u)}>Reset password</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => setQuota(u)}>Set quota</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => {
                    const role = u.role === "admin" ? "user" : "admin";
                    if (window.confirm("Change " + u.username + "'s role to " + role + "?")) act(u.id, () => api.accountAdmin.setRole(u.id, role));
                  }}>{u.role === "admin" ? "Remove admin" : "Make admin"}</button>
                  {u.totpEnabled && <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => {
                    if (window.confirm("Only proceed after verifying " + u.username + "'s identity independently. Disable their 2FA?")) act(u.id, () => api.accountAdmin.disable2fa(u.id));
                  }}>Reset 2FA</button>}
                  <button className="btn btn-danger-ghost" disabled={busy !== null || u.id === currentUserId} onClick={() => {
                    const disabled = !u.disabled;
                    if (window.confirm((disabled ? "Disable" : "Enable") + " account " + u.username + "?")) act(u.id, () => api.accountAdmin.setDisabled(u.id, disabled));
                  }}>{u.disabled ? "Enable" : "Disable"}</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
