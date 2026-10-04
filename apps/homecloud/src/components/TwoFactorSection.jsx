import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../api.js";

export default function TwoFactorSection({ totpEnabled, onChanged }) {
  const [stage, setStage] = useState("idle"); // idle | setup | recoveryCodes
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleStartSetup() {
    setError("");
    try {
      const { data } = await api.setup2fa();
      setOtpauthUrl(data.otpauthUrl);
      setSecret(data.secret);
      setStage("setup");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleConfirm(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.confirm2fa(code.trim());
      setRecoveryCodes(data.recoveryCodes);
      setStage("recoveryCodes");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleDone() {
    setStage("idle");
    setCode("");
    setRecoveryCodes([]);
    onChanged();
  }

  async function handleDisable() {
    const pw = window.prompt("Enter your password to disable two-factor authentication:");
    if (!pw) return;
    setError("");
    try {
      await api.disable2fa(pw);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRegenerateRecoveryCodes() {
    const pw = window.prompt(
      "Enter your password to generate new recovery codes.\nYour existing recovery codes will stop working."
    );
    if (!pw) return;
    setError("");
    try {
      const { data } = await api.regenerateRecoveryCodes(pw);
      setRecoveryCodes(data.recoveryCodes);
      setStage("recoveryCodes");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="auth-card" style={{ maxWidth: 420, marginBottom: 24 }}>
      <h1 className="auth-title" style={{ fontSize: 16 }}>Two-factor authentication</h1>

      {error && <div className="error-banner">{error}</div>}

      {stage === "idle" && !totpEnabled && (
        <>
          <p className="auth-subtitle">
            Add a second step at login using an authenticator app (like Google
            Authenticator or Authy), on top of your password.
          </p>
          <button className="btn btn-primary" onClick={handleStartSetup}>
            Enable two-factor authentication
          </button>
        </>
      )}

      {stage === "idle" && totpEnabled && (
        <>
          <p className="auth-subtitle" style={{ color: "var(--teal)" }}>
            ✓ Two-factor authentication is on.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button className="btn btn-ghost" onClick={handleRegenerateRecoveryCodes}>
              Generate new recovery codes
            </button>
            <button className="btn-danger-ghost" style={{ width: "100%", padding: 11 }} onClick={handleDisable}>
              Disable two-factor authentication
            </button>
          </div>
        </>
      )}

      {stage === "setup" && (
        <>
          <p className="auth-subtitle">
            Scan this with your authenticator app, then enter the 6-digit code
            it shows.
          </p>
          {/* #fff is deliberate and must NOT become a theme color: QR codes need a
              plain white background around them or phone scanners fail to read them. */}
          <div style={{ display: "flex", justifyContent: "center", background: "#fff", padding: 16, borderRadius: 6, marginBottom: 16 }}>
            <QRCodeSVG value={otpauthUrl} size={180} />
          </div>
          <p style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 16 }}>
            Can't scan it? Enter this key manually:{" "}
            <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{secret}</code>
          </p>
          <form onSubmit={handleConfirm}>
            <div className="field">
              <label htmlFor="totpCode">6-digit code</label>
              <input
                id="totpCode"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                autoFocus
                required
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? "Confirming…" : "Confirm and enable"}
            </button>
          </form>
        </>
      )}

      {stage === "recoveryCodes" && (
        <>
          <p className="auth-subtitle">
            Save these recovery codes somewhere safe. Each one can be used
            once to log in if you lose access to your authenticator app —
            they won't be shown again.
          </p>
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 12,
              marginBottom: 16,
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6
            }}
          >
            {recoveryCodes.map((c) => (
              <div key={c}>{c}</div>
            ))}
          </div>
          <button className="btn btn-primary" onClick={handleDone}>
            I've saved these codes
          </button>
        </>
      )}
    </div>
  );
}
