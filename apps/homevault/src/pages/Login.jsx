import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api.js";
import AppIcon from "../components/AppIcon.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";

export default function Login({ onAuthed }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pendingToken, setPendingToken] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function afterAuth(token) {
    setToken(token);
    const { data } = await api.me();
    onAuthed(data);
    navigate("/");
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.login(username, password);
      if (data.requires2fa) {
        setPendingToken(data.pendingToken);
      } else {
        await afterAuth(data.token);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCodeSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.verify2fa(pendingToken, code.trim());
      await afterAuth(data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (pendingToken) {
    return (
      <div className="auth-screen">
        <ThemeToggle className="btn btn-ghost theme-toggle-corner" />
        <div className="auth-card">
          <div className="auth-brand">
            <AppIcon name="homevault" size={16} /> HomeVault
          </div>
          <h1 className="auth-title">Enter your code</h1>
          <p className="auth-subtitle">Open your authenticator app, or use one of your recovery codes.</p>

          {error && <div className="error-banner">{error}</div>}

          <form onSubmit={handleCodeSubmit}>
            <div className="field">
              <label htmlFor="code">Authenticator code or recovery code</label>
              <input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                autoFocus
                required
              />
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
              {loading ? "Verifying…" : "Verify"}
            </button>
          </form>

          <div className="switch-row">
            <button
              className="btn-ghost"
              style={{ border: "none", background: "none", color: "var(--amber)", cursor: "pointer" }}
              type="button"
              onClick={() => {
                setPendingToken(null);
                setCode("");
                setError("");
              }}
            >
              ← Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <ThemeToggle className="btn btn-ghost theme-toggle-corner" />
      <div className="auth-card">
        <div className="auth-brand">
          <AppIcon name="homevault" size={16} /> HomeVault
        </div>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-subtitle">
          Sign in with your Home account first — unlocking your vault is a separate step, right after.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handlePasswordSubmit}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
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
              autoComplete="current-password"
              required
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
