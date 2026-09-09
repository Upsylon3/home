import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useVault } from "../vaultContext.jsx";
import AppIcon from "../components/AppIcon.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import { base64ToBytes, deriveMasterKeyBits, importAesKeyRaw, unwrapVaultKey, decryptString, VERIFIER_PLAINTEXT } from "../crypto.js";

export default function Unlock({ vaultRecord }) {
  const { unlock } = useVault();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const salt = base64ToBytes(vaultRecord.kdfSalt);
      const masterBits = await deriveMasterKeyBits(password, salt, vaultRecord.kdfParams);
      const masterWrappingKey = await importAesKeyRaw(masterBits);

      let vaultKey;
      try {
        vaultKey = await unwrapVaultKey(vaultRecord.wrappedKeyMaster, vaultRecord.wrappedKeyMasterIv, masterWrappingKey);
        // Confirm it's really right, not just "didn't throw" — see
        // crypto.js's VERIFIER_PLAINTEXT comment for why this exists.
        const verified = await decryptString(vaultRecord.verifier, vaultRecord.verifierIv, vaultKey);
        if (verified !== VERIFIER_PLAINTEXT) throw new Error("verifier mismatch");
      } catch {
        setError("That master password is incorrect.");
        setLoading(false);
        return;
      }

      unlock(vaultKey, { kdfParams: vaultRecord.kdfParams });
      navigate("/");
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <ThemeToggle className="btn btn-ghost theme-toggle-corner" />
      <div className="auth-card">
        <div className="auth-brand">
          <AppIcon name="homevault" size={16} /> HomeVault
        </div>
        <h1 className="auth-title">Unlock your vault</h1>
        <p className="auth-subtitle">Your master password never leaves this browser.</p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="masterPassword">Master password</label>
            <input
              id="masterPassword"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? "Unlocking…" : "Unlock"}
          </button>
        </form>

        <div className="switch-row">
          Forgot your master password? <Link to="/recover">Use your recovery key</Link>
        </div>
      </div>
    </div>
  );
}
