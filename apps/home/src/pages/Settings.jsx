import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api.js";
import { timeAgo } from "../utils.js";
import ThemeToggle from "../components/ThemeToggle.jsx";
import RetroControl from "../components/RetroControl.jsx";

// Home's Settings only covers what HomeCore itself owns: display name and
// sessions (§7.1, §7.2). Password, username, and two-factor auth are still
// entirely HomeCloud's territory (its own /api/auth surface) — Home isn't
// a replacement for every application's own UI, so this page links out to
// HomeCloud's account settings rather than duplicating that form.
export default function Settings() {
  const { user, onLogout } = useOutletContext();
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState("");
  const [loggingOutEverywhere, setLoggingOutEverywhere] = useState(false);

  useEffect(() => {
    api.mySessions()
      .then(({ data }) => setSessions(data.sessions))
      .catch(() => {});
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
        {sessions === null ? (
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
        <h3 className="panel-title">Password &amp; two-factor authentication</h3>
        <p className="panel-desc">
          Managed in HomeCloud's own account settings for now — Home doesn't duplicate that yet.
        </p>
      </div>
    </div>
  );
}
