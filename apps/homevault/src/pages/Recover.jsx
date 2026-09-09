import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useVault } from "../vaultContext.jsx";
import AppIcon from "../components/AppIcon.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import {
  DEFAULT_KDF_PARAMS,
  VERIFIER_PLAINTEXT,
  bytesToBase64,
  base64ToBytes,
  parseRecoveryKey,
  importAesKeyRaw,
  unwrapVaultKey,
  decryptString,
  encryptString,
  generateSalt,
  deriveMasterKeyBits,
  wrapVaultKey
} from "../crypto.js";

// Two steps in one component, same reasoning as Setup.jsx: unlocking via
// the recovery key and choosing a brand new master password are two
// genuinely different actions (the first proves who you are, the second
// changes how you'll prove it next time) even though they happen back
// to back here.
export default function Recover({ vaultRecord, onRecovered }) {
  const { unlock } = useVault();
  const navigate = useNavigate();
  const [recoveryInput, setRecoveryInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [vaultKey, setVaultKey] = useState(null); // set once recovery-key step succeeds
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function handleRecoverySubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const recoveryBytes = parseRecoveryKey(recoveryInput);
      const recoveryWrappingKey = await importAesKeyRaw(recoveryBytes);

      let unwrapped;
      try {
        unwrapped = await unwrapVaultKey(vaultRecord.wrappedKeyRecovery, vaultRecord.wrappedKeyRecoveryIv, recoveryWrappingKey);
        const verified = await decryptString(vaultRecord.verifier, vaultRecord.verifierIv, unwrapped);
        if (verified !== VERIFIER_PLAINTEXT) throw new Error("verifier mismatch");
      } catch {
        setError("That recovery key doesn't match this vault.");
        setLoading(false);
        return;
      }

      setVaultKey(unwrapped);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleNewPasswordSubmit(e) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 12) {
      setError("Use at least 12 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const salt = generateSalt();
      const masterBits = await deriveMasterKeyBits(newPassword, salt, DEFAULT_KDF_PARAMS);
      const masterWrappingKey = await importAesKeyRaw(masterBits);
      const masterWrap = await wrapVaultKey(vaultKey, masterWrappingKey);
      const verifier = await encryptString(VERIFIER_PLAINTEXT, vaultKey);

      const { data } = await api.vault.rewrap({
        kdfSalt: bytesToBase64(salt),
        kdfParams: DEFAULT_KDF_PARAMS,
        wrappedKeyMaster: masterWrap.ciphertext,
        wrappedKeyMasterIv: masterWrap.iv,
        verifier: verifier.ciphertext,
        verifierIv: verifier.iv
      });

      onRecovered(data.vault);
      unlock(vaultKey, { kdfParams: DEFAULT_KDF_PARAMS });
      navigate("/");
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  if (vaultKey) {
    return (
      <div className="auth-screen">
        <ThemeToggle className="btn btn-ghost theme-toggle-corner" />
        <div className="auth-card">
          <div className="auth-brand">
            <AppIcon name="homevault" size={16} /> HomeVault
          </div>
          <h1 className="auth-title">Choose a new master password</h1>
          <p className="auth-subtitle">
            Your recovery key was correct. Your items are safe and unaffected — only your master password is
            changing.
          </p>

          {error && <div className="error-banner">{error}</div>}

          <form onSubmit={handleNewPasswordSubmit}>
            <div className="field">
              <label htmlFor="newPassword">New master password</label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
                required
              />
            </div>
            <div className="field">
              <label htmlFor="confirmNewPassword">Confirm new master password</label>
              <input
                id="confirmNewPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save and continue"}
            </button>
          </form>
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
        <h1 className="auth-title">Recover your vault</h1>
        <p className="auth-subtitle">
          Enter the recovery key you saved when this vault was created. There's no other way in without it.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleRecoverySubmit}>
          <div className="field">
            <label htmlFor="recoveryKey">Recovery key</label>
            <input
              id="recoveryKey"
              value={recoveryInput}
              onChange={(e) => setRecoveryInput(e.target.value)}
              placeholder="XXXXX-XXXXX-XXXXX-..."
              autoFocus
              required
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? "Checking…" : "Continue"}
          </button>
        </form>

        <div className="switch-row">
          <Link to="/unlock">← Back to unlock with master password</Link>
        </div>
      </div>
    </div>
  );
}
