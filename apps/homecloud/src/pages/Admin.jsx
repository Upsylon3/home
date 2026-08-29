import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { formatBytes, formatDate, describeActivity } from "../utils.js";

export default function Admin({ user }) {
  const [users, setUsers] = useState([]);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  async function refresh() {
    try {
      const { data } = await api.admin.listUsers();
      setUsers(data.users);
    } catch (err) {
      setError(err.message);
    }
  }

  async function refreshActivity() {
    try {
      const { data } = await api.admin.activity();
      setActivity(data.activity);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    refreshActivity();
  }, []);

  async function withBusy(id, fn) {
    setBusyId(id);
    setError("");
    try {
      await fn();
      await Promise.all([refresh(), refreshActivity()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function handleResetPassword(u) {
    const newPassword = window.prompt(`New password for "${u.username}" (min 8 characters):`);
    if (!newPassword) return;
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    withBusy(u.id, () => api.admin.resetPassword(u.id, newPassword));
  }

  function handleToggleDisabled(u) {
    const action = u.disabled ? "re-enable" : "disable";
    if (!window.confirm(`Are you sure you want to ${action} "${u.username}"'s account?`)) return;
    withBusy(u.id, () => api.admin.setDisabled(u.id, !u.disabled));
  }

  function handleSetQuota(u) {
    const currentGB = (u.quotaBytes / 1024 ** 3).toFixed(1);
    const input = window.prompt(
      `Storage quota for "${u.username}" in GB (currently ${currentGB} GB).\nLeave blank to reset to the server default.`,
      currentGB
    );
    if (input === null) return;
    const trimmed = input.trim();
    if (trimmed === "") {
      withBusy(u.id, () => api.admin.setQuota(u.id, null));
      return;
    }
    const gb = Number(trimmed);
    if (!Number.isFinite(gb) || gb <= 0) {
      setError("Quota must be a positive number of GB.");
      return;
    }
    withBusy(u.id, () => api.admin.setQuota(u.id, Math.round(gb * 1024 ** 3)));
  }

  function handleToggleRole(u) {
    const nextRole = u.role === "admin" ? "user" : "admin";
    const verb = nextRole === "admin" ? "make" : "remove";
    if (!window.confirm(`${verb === "make" ? "Make" : "Remove"} "${u.username}" ${verb === "make" ? "an admin" : "as an admin"}?`)) {
      return;
    }
    withBusy(u.id, () => api.admin.setRole(u.id, nextRole));
  }

  function handleForceDisable2fa(u) {
    if (
      !window.confirm(
        `Disable two-factor authentication for "${u.username}"?\n\nOnly do this after confirming their identity some other way (they're locked out and have no recovery codes).`
      )
    ) {
      return;
    }
    withBusy(u.id, () => api.admin.disable2fa(u.id));
  }

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span>●</span> homecloud
        </div>
        <div className="sidebar-user">
          Signed in as
          <strong>{user?.username}</strong>
        </div>
        <div className="sidebar-spacer" />
        <Link className="btn btn-ghost" to="/" style={{ textAlign: "center", textDecoration: "none" }}>
          ← Back to files
        </Link>
      </aside>

      <main className="main">
        <div className="main-header">
          <h1>Admin panel</h1>
          <span className="count">{users.length} account{users.length === 1 ? "" : "s"}</span>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <table className="file-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>2FA</th>
              <th>Storage</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="file-name">{u.username}</td>
                <td className="file-meta">{u.role}</td>
                <td className="file-meta">{u.disabled ? "Disabled" : "Active"}</td>
                <td className="file-meta">{u.totpEnabled ? "On" : "—"}</td>
                <td className="file-meta">
                  {/* null (not 0) means homecloud-backend couldn't be reached
                      for this request — a genuinely different fact from
                      "using zero storage," see homecore/src/admin.js's
                      comment. Everything else on this page (disable, role,
                      quota, 2FA reset) still works regardless. */}
                  {u.usedBytes === null ? "Usage unavailable" : `${formatBytes(u.usedBytes)} / ${formatBytes(u.quotaBytes)}`}
                </td>
                <td>
                  <div className="file-actions" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button
                      className="btn btn-ghost"
                      style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
                      disabled={busyId === u.id}
                      onClick={() => handleResetPassword(u)}
                    >
                      Reset password
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
                      disabled={busyId === u.id}
                      onClick={() => handleSetQuota(u)}
                    >
                      Set quota
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
                      disabled={busyId === u.id}
                      onClick={() => handleToggleRole(u)}
                    >
                      {u.role === "admin" ? "Remove admin" : "Make admin"}
                    </button>
                    {u.totpEnabled && (
                      <button
                        className="btn btn-ghost"
                        style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
                        disabled={busyId === u.id}
                        onClick={() => handleForceDisable2fa(u)}
                      >
                        Disable 2FA
                      </button>
                    )}
                    <button
                      className="btn-danger-ghost"
                      disabled={busyId === u.id || u.id === user?.id}
                      title={u.id === user?.id ? "You can't disable your own account" : undefined}
                      onClick={() => handleToggleDisabled(u)}
                    >
                      {u.disabled ? "Enable" : "Disable"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h1 style={{ fontFamily: "var(--font-mono)", fontSize: 16, margin: "32px 0 16px" }}>
          Activity log
        </h1>
        {activity.length === 0 ? (
          <div className="empty-state">
            <span className="glyph">[ ]</span>
            No activity yet.
          </div>
        ) : (
          <table className="file-table">
            <thead>
              <tr>
                <th>Who</th>
                <th>What</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((entry, i) => (
                <tr key={i}>
                  <td className="file-name">{entry.username}</td>
                  <td className="file-meta">{describeActivity(entry)}</td>
                  <td className="file-meta">{formatDate(entry.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
