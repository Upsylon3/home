import { useEffect, useState } from "react";
import { api } from "../api.js";

// All operations use HomeCore's existing authentication endpoints.
// Recovery codes are intentionally held only in component memory.
export default function TwoFactorControls() {
  const [enabled, setEnabled] = useState(null);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const { data } = await api.twoFactor.status();
    setEnabled(Boolean(data.totpEnabled ?? data.user?.totpEnabled));
  }

  useEffect(() => { refresh().catch(() => setError("Unable to load two-factor status.")); }, []);

  async function run(action) {
    setError("");
    setBusy(true);
    try { await action(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function complete() {
    setRecoveryCodes(null);
    setSetup(null);
    setCode("");
    setPassword("");
    refresh().catch(() => setError("Unable to refresh two-factor status."));
  }

  return (
    <section className="panel" aria-labelledby="home-totp-heading" aria-busy={busy}>
      <h3 id="home-totp-heading" className="panel-title">Two-factor authentication</h3>
      <p className="panel-desc">Protect your HOME account with a time-based authenticator and one-use recovery codes.</p>
      {error && <p role="alert">{error}</p>}
      {enabled === null && !error && <p>Loading…</p>}
      {enabled === null && error && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(refresh)}>Retry</button>}
      {recoveryCodes ? (
        <>
          <p role="status">Save these recovery codes securely. They will not be shown again.</p>
          <ul>{recoveryCodes.map(value => <li key={value}><code>{value}</code></li>)}</ul>
          <button className="btn btn-primary btn-sm" onClick={complete}>I saved these codes</button>
        </>
      ) : setup ? (
        <>
          <p>Add this secret manually to your authenticator application:</p>
          <p><code>{setup.secret}</code></p>
          <p className="panel-desc">Keep this secret private. Use manual entry in your authenticator application.</p>
          <form onSubmit={e => { e.preventDefault(); run(async () => {
            const { data } = await api.twoFactor.confirm(code.trim());
            setRecoveryCodes(data.recoveryCodes);
            setEnabled(true);
            setSetup(null);
            setCode("");
          }); }}>
            <div className="field"><label htmlFor="home-totp-code">Authenticator code</label>
              <input id="home-totp-code" autoComplete="one-time-code" inputMode="numeric" required value={code} onChange={e => setCode(e.target.value)} /></div>
            <button className="btn btn-primary btn-sm" disabled={busy}>Confirm and enable</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setSetup(null); setCode(""); setError(""); }}>Cancel</button>
          </form>
        </>
      ) : enabled === false ? (
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(async () => {
          const { data } = await api.twoFactor.setup();
          setSetup(data);
        })}>Set up two-factor authentication</button>
      ) : enabled === true ? (
        <>
          <p role="status">Two-factor authentication is enabled.</p>
          <form onSubmit={e => { e.preventDefault(); run(async () => {
            const { data } = await api.twoFactor.regenerate(password);
            setRecoveryCodes(data.recoveryCodes);
            setPassword("");
          }); }}>
            <div className="field"><label htmlFor="home-totp-password">Confirm your password</label>
              <input id="home-totp-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
            <button className="btn btn-ghost btn-sm" disabled={busy}>Regenerate recovery codes</button>
            <button type="button" className="btn btn-danger-ghost" disabled={busy || !password} onClick={() => {
              if (!window.confirm("Disable two-factor authentication for this account?")) return;
              run(async () => { await api.twoFactor.disable(password); setPassword(""); await refresh(); });
            }}>Disable two-factor authentication</button>
          </form>
        </>
      ) : null}
    </section>
  );
}
