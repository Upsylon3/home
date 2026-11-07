import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api, setToken } from "../api.js";
import { timeAgo } from "../utils.js";
import ThemeToggle from "../components/ThemeToggle.jsx";
import RetroControl from "../components/RetroControl.jsx";
import FollowupControls from "../components/FollowupControls.jsx";
import VaultResetControls from "../components/VaultResetControls.jsx";
import ApplicationAccessControls from '../components/ApplicationAccessControls.jsx';

// Core owns account security; HOME is the unified account interface.
export default function Settings() {
  const { user, onLogout } = useOutletContext();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [sessions, setSessions] = useState(null);
  const [sessionError, setSessionError] = useState(false);
  const [activity, setActivity] = useState(null);
  const [activityError, setActivityError] = useState(false);
  const [error, setError] = useState("");
  const [loggingOutEverywhere, setLoggingOutEverywhere] = useState(false);

  useEffect(() => {
    api.mySessions()
      .then(({ data }) => setSessions(data.sessions))
      .catch(() => setSessionError(true));
    api.myActivity(15)
      .then(({ data }) => setActivity(data.events))
      .catch(() => setActivityError(true));
  }, []);

  async function handleSaveName(e) {
    e.preventDefault();
    setError("");
    setSavingName(true);
    setNameSaved(false);
    try {
      await api.updateMe(displayName.trim() || null);
      setNameSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setError("");
    setPasswordMessage("");
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setChangingPassword(true);
    try {
      const { data } = await api.changePassword(currentPassword, newPassword);
      setToken(data.token);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Password updated. Other sessions have been signed out.");
    } catch (err) {
      setError(err.message);
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleLogoutEverywhere() {
    if (!window.confirm("Sign out of every device, including this one?")) return;
    setLoggingOutEverywhere(true);
    try {
      await api.logoutEverywhere();
      onLogout();
    } catch (err) {
      setError(err.message);
      setLoggingOutEverywhere(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <p className="page-eyebrow">Settings</p>
        <h1 className="page-title">Your account</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <FollowupControls user={user} />
      <ApplicationAccessControls />
      {user.role === "admin" && <VaultResetControls />}

      <div className="panel">
        <h3 className="panel-title">Appearance</h3>
        <p className="panel-desc">
          Light, dark, or match your device's setting automatically.
        </p>
        <ThemeToggle className="btn btn-ghost btn-sm" />
        <p className="panel-desc" style={{ margin: "20px 0 8px" }}>
          Retro intensity: how strongly the 1970s console styling shows.
        </p>
        <RetroControl />
      </div>

      <div className="panel">
        <h3 className="panel-title">Display name</h3>
        <p className="panel-desc">How your name appears across Home. Leave blank to just show your username.</p>
        <form onSubmit={handleSaveName} className="form-row">
          <div className="field">
            <input
              placeholder={user.username}
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setNameSaved(false);
              }}
              maxLength={64}
            />
          </div>
          <button className="btn btn-primary btn-sm" type="submit" disabled={savingName}>
            {savingName ? "Saving…" : nameSaved ? "Saved" : "Save"}
          </button>
        </form>
      </div>

      <div className="panel">
        <h3 className="panel-title">Sessions</h3>
        <p className="panel-desc">Every device that's signed in with your account.</p>
        {sessionError ? (
          <p role="alert">Could not load sessions. Refresh to try again.</p>
        ) : sessions === null ? (
          <p style={{ color: "var(--text-dim)", fontSize: 13 }}>Loading…</p>
        ) : sessions.length === 0 ? (
          <p style={{ color: "var(--text-dim)", fontSize: 13 }}>No session history yet.</p>
        ) : (
          sessions.map((s) => (
            <div className="session-row" key={s.id}>
              <div>
                <div className="session-device">{s.deviceName || "Unknown device"}</div>
                <div className="session-meta">
                  {s.revokedAt ? "Signed out" : `Last active ${timeAgo(s.lastSeenAt)}`}
                </div>
              </div>
            </div>
          ))
        )}
        <button
          className="btn btn-danger-ghost"
          style={{ marginTop: 16 }}
          onClick={handleLogoutEverywhere}
          disabled={loggingOutEverywhere}
        >
          {loggingOutEverywhere ? "Signing out…" : "Sign out of every device"}
        </button>
      </div>

      <div className="panel">
        <h3 className="panel-title">Recent account activity</h3>
        <p className="panel-desc">Your recent activity across HOME applications.</p>
        {activityError ? (
          <p role="alert">Could not load account activity. Refresh to try again.</p>
        ) : activity === null ? (
          <p>Loading…</p>
        ) : activity.length === 0 ? (
          <p>No recent activity.</p>
        ) : (
          <ul>
            {activity.map((entry, index) => (
              <li key={entry.id ?? index}>
                <strong>{entry.eventType || "Account event"}</strong>
                {entry.createdAt && <span> — {timeAgo(entry.createdAt)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title">Password</h3>
        <p className="panel-desc">Changing your password signs out other devices.</p>
        {passwordMessage && <p role="status">{passwordMessage}</p>}
        <form onSubmit={handleChangePassword}>
          <div className="field">
            <label htmlFor="currentPassword">Current password</label>
            <input id="currentPassword" type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="newPassword">New password</label>
            <input id="newPassword" type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">Confirm new password</label>
            <input id="confirmPassword" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-sm" type="submit" disabled={changingPassword}>
            {changingPassword ? "Updating…" : "Change password"}
          </button>
        </form>
      </div>
    </div>
  );
}
