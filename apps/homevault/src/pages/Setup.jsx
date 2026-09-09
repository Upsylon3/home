import { useState } from "react";
import { api } from "../api.js";
import { useVault } from "../vaultContext.jsx";
import AppIcon from "../components/AppIcon.jsx";
import { CopyGlyph } from "../components/icons.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import {
  DEFAULT_KDF_PARAMS,
  VERIFIER_PLAINTEXT,
  bytesToBase64,
  generateSalt,
  generateVaultKey,
  generateRecoveryKeyBytes,
  formatRecoveryKey,
  deriveMasterKeyBits,
  importAesKeyRaw,
  wrapVaultKey,
  encryptString
} from "../crypto.js";

// Two steps: create the vault (below the fold, everything actually
// happens here), then a mandatory "show the recovery kit once" screen
// before the user can move on. The two are visually one flow, but
// deliberately can't be collapsed into one screen — someone needs to
// actually see and acknowledge the recovery kit, not just have it
// silently generated in the background where they might never notice
// it existed until they need it and don't have it.
export default function Setup({ onCreated }) {
  const { unlock } = useVault();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryKit, setRecoveryKit] = useState(null); // formatted string, once created
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [pendingUnlock, setPendingUnlock] = useState(null); // {vaultKey, vaultRecord} — applied only after confirmation

  async function handleCreate(e) {
    e.preventDefault();
    setError("");

    if (password.length < 12) {
      setError("Use at least 12 characters — this is the one password protecting everything else in here.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const vaultKey = await generateVaultKey();

      const salt = generateSalt();
      const masterBits = await deriveMasterKeyBits(password, salt, DEFAULT_KDF_PARAMS);
      const masterWrappingKey = await importAesKeyRaw(masterBits);
      const masterWrap = await wrapVaultKey(vaultKey, masterWrappingKey);

      const recoveryBytes = generateRecoveryKeyBytes();
      const recoveryWrappingKey = await importAesKeyRaw(recoveryBytes);
      const recoveryWrap = await wrapVaultKey(vaultKey, recoveryWrappingKey);

      const verifier = await encryptString(VERIFIER_PLAINTEXT, vaultKey);

      const { data } = await api.vault.create({
        kdfSalt: bytesToBase64(salt),
        kdfParams: DEFAULT_KDF_PARAMS,
        wrappedKeyMaster: masterWrap.ciphertext,
        wrappedKeyMasterIv: masterWrap.iv,
        wrappedKeyRecovery: recoveryWrap.ciphertext,
        wrappedKeyRecoveryIv: recoveryWrap.iv,
        verifier: verifier.ciphertext,
        verifierIv: verifier.iv
      });

      // Hold the unlock until the recovery kit is actually acknowledged
      // — see the component comment above for why this isn't just
      // applied immediately.
      setPendingUnlock({ vaultKey, vaultRecord: data.vault });
      setRecoveryKit(formatRecoveryKey(recoveryBytes));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleContinue() {
    if (!pendingUnlock) return;
    unlock(pendingUnlock.vaultKey, { kdfParams: DEFAULT_KDF_PARAMS });
    onCreated(pendingUnlock.vaultRecord);
  }

  function copyRecoveryKit() {
    navigator.clipboard?.writeText(recoveryKit).catch(() => {});
  }

  function downloadRecoveryKit() {
    const blob = new Blob(
      [
        "HomeVault recovery key\n",
        "Generated when this vault was created. This is the ONLY way back in\n",
        "if the master password is ever forgotten — HomeVault cannot reset it\n",
        "any other way, and this text is never stored anywhere on the server.\n\n",
        recoveryKit + "\n"
      ],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "homevault-recovery-key.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (recoveryKit) {
    return (
      <div className="auth-screen">
        <ThemeToggle className="btn btn-ghost theme-toggle-corner" />
        <div className="auth-card" style={{ maxWidth: 480 }}>
          <div className="auth-brand">
            <AppIcon name="homevault" size={16} /> HomeVault
          </div>
          <h1 className="auth-title">Save your recovery key</h1>
          <p className="auth-subtitle">
            This is the <strong>only</strong> way back into your vault if you ever forget your master password.
            HomeVault has no other way to reset it — there's no "reset password" email, because the server never
            has anything readable to reset. It will not be shown again.
          </p>

          <div className="recovery-kit-box">{recoveryKit}</div>

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button className="btn btn-ghost" type="button" onClick={copyRecoveryKit}>
              <CopyGlyph size={15} /> Copy
            </button>
            <button className="btn btn-ghost" type="button" onClick={downloadRecoveryKit}>
              Download as text file
            </button>
          </div>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 16 }}>
            <input type="checkbox" checked={savedConfirmed} onChange={(e) => setSavedConfirmed(e.target.checked)} />
            <span>I've saved this somewhere safe and offline — not just in this browser.</span>
          </label>

          <button className="btn btn-primary btn-block" type="button" disabled={!savedConfirmed} onClick={handleContinue}>
            Continue to my vault
          </button>
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
        <h1 className="auth-title">Create your vault</h1>
        <p className="auth-subtitle">
          Choose a master password. It's never sent to the server, and the server has no way to recover it if you
          lose it — that's what the recovery key on the next screen is for.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleCreate}>
          <div className="field">
            <label htmlFor="password">Master password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">Confirm master password</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? "Creating vault…" : "Create vault"}
          </button>
        </form>
      </div>
    </div>
  );
}
