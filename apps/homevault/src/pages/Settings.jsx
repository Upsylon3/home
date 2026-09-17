import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useVault } from "../vaultContext.jsx";
import { CopyGlyph } from "../components/icons.jsx";
import {
  DEFAULT_KDF_PARAMS,
  VERIFIER_PLAINTEXT,
  bytesToBase64,
  generateSalt,
  deriveMasterKeyBits,
  importAesKeyRaw,
  wrapVaultKey,
  encryptString,
  generateRecoveryKeyBytes,
  formatRecoveryKey
} from "../crypto.js";

// Same reasoning as Setup.jsx's identical constant: auto-clear the
// clipboard a short while after copying a credential that can never be
// reissued if it leaks.
const CLIPBOARD_CLEAR_MS = 30 * 1000;

export default function Settings({ onVaultUpdated }) {
  const { vaultKey, lock } = useVault();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const [newRecoveryKit, setNewRecoveryKit] = useState(null);
  const [recoveryGenerating, setRecoveryGenerating] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryCopied, setRecoveryCopied] = useState(false);

  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  function copyNewRecoveryKit() {
    navigator.clipboard
      ?.writeText(newRecoveryKit)
      .then(() => {
        setRecoveryCopied(true);
        setTimeout(() => setRecoveryCopied(false), 2000);
        setTimeout(() => {
          navigator.clipboard?.writeText("").catch(() => {});
        }, CLIPBOARD_CLEAR_MS);
      })
      .catch(() => {});
  }

  // Deliberately doesn't ask for the CURRENT master password first: the
  // vault is already unlocked (vaultKey is sitting in memory), and
  // "someone with an already-unlocked session" is an explicitly accepted
  // risk in docs/SECURITY.md, mitigated by auto-lock rather than
  // eliminated. Re-deriving from the vaultKey we already have is simpler
  // and no less secure than re-proving what unlocking already proved.
  async function handleChangePassword(e) {
    e.preventDefault();
    setPasswordError("");
    setPasswordMessage("");

    if (newPassword.length < 12) {
      setPasswordError("Use at least 12 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords don't match.");
      return;
    }

    setPasswordSaving(true);
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

      onVaultUpdated(data.vault);
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Master password changed.");
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleRegenerateRecovery() {
    setRecoveryError("");
    setRecoveryGenerating(true);
    try {
      const recoveryBytes = generateRecoveryKeyBytes();
      const recoveryWrappingKey = await importAesKeyRaw(recoveryBytes);
      const recoveryWrap = await wrapVaultKey(vaultKey, recoveryWrappingKey);

      const { data } = await api.vault.regenerateRecovery({
        wrappedKeyRecovery: recoveryWrap.ciphertext,
        wrappedKeyRecoveryIv: recoveryWrap.iv
      });

      onVaultUpdated(data.vault);
      setNewRecoveryKit(formatRecoveryKey(recoveryBytes));
    } catch (err) {
      setRecoveryError(err.message);
    } finally {
      setRecoveryGenerating(false);
    }
  }

  async function handleDeleteVault() {
    setDeleteError("");
    setDeleting(true);
    try {
      await api.vault.destroy();
      lock();
      navigate("/setup");
      window.location.reload(); // simplest way to force App.jsx to re-check vault existence from scratch
    } catch (err) {
      setDeleteError(err.message);
      setDeleting(false);
    }
  }

  return (
    <div style={{ padding: "20px 24px", maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>Change master password</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
        Your vault key doesn't change — only how it's protected does. Every item stays exactly as it is.
      </p>
      {passwordError && <div className="error-banner" style={{ marginBottom: 12 }}>{passwordError}</div>}
      {passwordMessage && <div className="error-banner" style={{ marginBottom: 12, color: "var(--teal)", borderColor: "var(--teal)" }}>{passwordMessage}</div>}
      <form onSubmit={handleChangePassword}>
        <div className="field">
          <label htmlFor="newPassword">New master password</label>
          <input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="field">
          <label htmlFor="confirmPassword">Confirm new master password</label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={passwordSaving}>
          {passwordSaving ? "Saving…" : "Change password"}
        </button>
      </form>

      <hr className="nav-divider" style={{ margin: "28px 0" }} />

      <h2>Recovery key</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
        Generating a new one immediately invalidates any recovery key you saved before — make sure you save the new
        one before leaving this page.
      </p>
      {recoveryError && <div className="error-banner" style={{ marginBottom: 12 }}>{recoveryError}</div>}
      {newRecoveryKit ? (
        <>
          <div className="recovery-kit-box">{newRecoveryKit}</div>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={copyNewRecoveryKit}
          >
            <CopyGlyph size={15} /> {recoveryCopied ? "Copied — clears in 30s" : "Copy"}
          </button>
        </>
      ) : (
        <button className="btn btn-ghost" type="button" onClick={handleRegenerateRecovery} disabled={recoveryGenerating}>
          {recoveryGenerating ? "Generating…" : "Generate a new recovery key"}
        </button>
      )}

      <div className="danger-zone">
        <h3>Danger zone</h3>
        <p style={{ fontSize: 13 }}>
          Deleting your vault permanently destroys every item in it, along with the only keys that could ever
          decrypt them. There is no undo — not even a support request can bring it back, by design.
        </p>
        {deleteError && <div className="error-banner" style={{ marginBottom: 12 }}>{deleteError}</div>}
        <div className="field">
          <label htmlFor="deleteConfirm">Type DELETE to confirm</label>
          <input id="deleteConfirm" value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} />
        </div>
        <button
          className="btn-danger-ghost btn"
          type="button"
          disabled={deleteConfirmText !== "DELETE" || deleting}
          onClick={handleDeleteVault}
        >
          {deleting ? "Deleting…" : "Delete vault permanently"}
        </button>
      </div>
    </div>
  );
}
