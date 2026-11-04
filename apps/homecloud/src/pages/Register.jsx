import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setToken } from "../api.js";
import ThemeToggle from "../components/ThemeToggle.jsx";

export default function Register({ onAuthed }) {
  const [setupCode, setSetupCode] = useState("");
  const [registration, setRegistration] = useState(null);
  const [setupError, setSetupError] = useState("");
  useEffect(() => {
    let active = true;
    api.registration().then(({ data }) => { if (active) setRegistration(data); })
      .catch(() => { if (active) setSetupError("Could not check account setup. Reload this page to try again."); });
    return () => { active = false; };
  }, []);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.register(username, password, setupCode);
      setToken(data.token);
      onAuthed(data.user);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <ThemeToggle className="btn btn-ghost theme-toggle-corner" />
      <div className="auth-card">
        <div className="auth-brand">
          <span>●</span> homecloud
        </div>
        <h1 className="auth-title">Create account</h1>
        <p className="auth-subtitle">3-32 characters, letters/numbers/._- for the username.</p>

        {setupError && <div className="error-banner" role="alert">{setupError}</div>}
        {registration?.requiresSetupCode && <p className="auth-subtitle">{registration.ownerCreated ? "Ask the server owner for a new setup code to join this HOME." : "Create the owner account using the setup code displayed on your server."} Codes work once and expire after 15 minutes. Complete initial setup on the server itself or over HTTPS.</p>}
        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          {registration?.requiresSetupCode && (
            <div className="field">
              <label htmlFor="setup-code">Setup code</label>
              <input id="setup-code" value={setupCode} onChange={e => setSetupCode(e.target.value)} autoComplete="off" spellCheck={false} required />
            </div>
          )}
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading || !registration}>
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <div className="switch-row">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
