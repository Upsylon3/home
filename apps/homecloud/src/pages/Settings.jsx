import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setToken } from "../api.js";
import { formatDate, describeActivity } from "../utils.js";
import TwoFactorSection from "../components/TwoFactorSection.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import RetroControl from "../components/RetroControl.jsx";

export default function Settings({ user, onLogout }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);
  const [activity, setActivity] = useState([]);
  const [me, setMe] = useState(null);
  const navigate = useNavigate();

  function refreshMe() {
    api.me().then(({ data }) => setMe(data)).catch(() => {});
  }

  useEffect(() => {
    api.myActivity().then(({ data }) => setActivity(data.activity)).catch(() => {});
    refreshMe();
  }, []);

  async function handleChangePassword(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.changePassword(currentPassword, newPassword);
      setToken(data.token);
      setSuccess("Password changed. You're still signed in here; every other device has been signed out.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogoutEverywhere() {
    if (!window.confirm("This signs out every device using your account, including this one. Continue?")) {
      return;
    }
    setSigningOutEverywhere(true);
    try {
      await api.logoutEverywhere();
    } catch {
      // even if the request fails, clearing the local token still logs this device out
    }
    setToken(null);
    onLogout();
    navigate("/login");
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
        <ThemeToggle />
        <Link className="btn btn-ghost" to="/" style={{ textAlign: "center", textDecoration: "none", marginTop: 8 }}>
          ← Back to files
        </Link>
      </aside>

      <main className="main">
        <div className="main-header">
          <h1>Account settings</h1>
        </div>

        <div className="auth-card" style={{ maxWidth: 420, marginBottom: 24 }}>
          <h1 className="auth-title" style={{ fontSize: 16 }}>Appearance</h1>
          <p className="auth-subtitle">
            Retro intensity: how strongly the 1970s console styling shows.
          </p>
          <RetroControl />
        </div>

        <div className="auth-card" style={{ maxWidth: 420, marginBottom: 24 }}>
          <h1 className="auth-title" style={{ fontSize: 16 }}>Change password</h1>
          <p className="auth-subtitle">
            Changing your password automatically signs out every other device
            using this account.
          </p>

          {error && <div className="error-banner">{error}</div>}
          {success && (
            <div className="error-banner is-ok">
              {success}
            </div>
          )}

          <form onSubmit={handleChangePassword}>
            <div className="field">
              <label htmlFor="currentPassword">Current password</label>
              <input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="newPassword">New password</label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="confirmPassword">Confirm new password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? "Updating…" : "Change password"}
            </button>
          </form>
        </div>

        <TwoFactorSection totpEnabled={me?.totpEnabled} onChanged={refreshMe} />

        <div className="auth-card" style={{ maxWidth: 420, marginBottom: 24 }}>
          <h1 className="auth-title" style={{ fontSize: 16 }}>Sign out everywhere</h1>
          <p className="auth-subtitle">
            Lost your phone, or think someone else might be signed in as you?
            This immediately signs out every device, including this one.
          </p>
          <button className="btn-danger-ghost" style={{ width: "100%", padding: 11 }} onClick={handleLogoutEverywhere} disabled={signingOutEverywhere}>
            {signingOutEverywhere ? "Signing out everywhere…" : "Sign out of all devices"}
          </button>
        </div>

        <div className="auth-card" style={{ maxWidth: 420 }}>
          <h1 className="auth-title" style={{ fontSize: 16 }}>Recent activity</h1>
          <p className="auth-subtitle">The last things that happened on your account.</p>
          {activity.length === 0 ? (
            <p style={{ color: "var(--text-dim)", fontSize: 13 }}>Nothing yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {activity.slice(0, 15).map((entry, i) => (
                <li key={i} style={{ fontSize: 13, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
                  <div>{describeActivity(entry)}</div>
                  <div className="file-meta" style={{ fontSize: 11 }}>{formatDate(entry.createdAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
