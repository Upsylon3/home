import { useState } from "react";
import { api } from "../api.js";

export default function VaultResetControls() {
  const [users, setUsers] = useState(null), [selected, setSelected] = useState("");
  const [vault, setVault] = useState(null), [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const target = users?.find(u => String(u.id) === selected);
  const expected = `DELETE ${selected}`;
  async function loadUsers() {
    setBusy(true); setError(""); setNotice(""); setVault(null); setConfirmation(""); setSelected("");
    try { setUsers((await api.vaultAdmin.users()).data.users); }
    catch (e) { setUsers(null); setError(e.message); }
    finally { setBusy(false); }
  }
  async function check() {
    setBusy(true); setError(""); setNotice(""); setVault(null); setConfirmation("");
    try { setVault((await api.vaultAdmin.status(selected)).data); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function reset(e) {
    e.preventDefault();
    if (!target || !vault?.exists || confirmation !== expected || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.vaultAdmin.reset(selected, vault.vaultId, confirmation);
      setNotice(`Current vault removed for ${target.username}. They can create a new vault in HomeVault.`);
    } catch (err) { setError(`${err.message} Check the vault again before retrying.`); }
    finally { setVault(null); setConfirmation(""); setBusy(false); }
  }
  return <section className="panel" aria-labelledby="vault-admin-title">
    <h3 className="panel-title" id="vault-admin-title">Reset a family member's vault</h3>
    <p className="panel-desc">Administrator action for someone starting over after losing their master password and recovery kit. This cannot recover their secrets.</p>
    <p className="panel-desc">Removes the current vault, all active items and Trash, with no in-app undo. Backups, exports and already unlocked devices may retain copies. This does not securely erase those copies.</p>
    <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={loadUsers}>Load accounts</button>
    {users && <div className="field" style={{ marginTop: 16 }}>
      <label htmlFor="vault-admin-account">Account</label>
      <select id="vault-admin-account" value={selected} disabled={busy} onChange={e => {
        setSelected(e.target.value); setVault(null); setConfirmation(""); setError(""); setNotice("");
      }}>
        <option value="">Choose an account</option>
        {users.map(u => <option key={u.id} value={u.id}>{u.username} · account {u.id}{u.disabled ? " · disabled" : ""}</option>)}
      </select>
    </div>}
    {target && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={check}>Check vault</button>}
    <div role="status" aria-live="polite">
      {busy && <p>Working…</p>}
      {vault && !vault.exists && <p>This account has no current vault.</p>}
      {notice && <p>{notice}</p>}
    </div>
    {error && <p role="alert" className="error-banner">{error}</p>}
    {target && vault?.exists && <form onSubmit={reset}>
      <p>Reset <strong>{target.username}</strong>'s vault (account {selected})?</p>
      <div className="field">
        <label htmlFor="vault-admin-confirm">Type {expected} to confirm</label>
        <input id="vault-admin-confirm" autoComplete="off" spellCheck={false} value={confirmation}
          disabled={busy} onChange={e => setConfirmation(e.target.value)} />
      </div>
      <button className="btn btn-danger-ghost" type="submit" disabled={busy || confirmation !== expected}>Delete this vault</button>
    </form>}
  </section>;
}
