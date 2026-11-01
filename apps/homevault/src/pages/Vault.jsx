import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useVault } from "../vaultContext.jsx";
import { decryptString } from "../crypto.js";
import { KeyGlyph, NoteGlyph, CardGlyph } from "../components/icons.jsx";

const TYPE_ICON = { login: KeyGlyph, note: NoteGlyph, card: CardGlyph };

export default function Vault({ trash = false }) {
  const { vaultKey } = useVault();
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data } = await api.items.list(trash);
        // Every title is independently encrypted (see
        // apps/homevault-backend/src/db.js) — decrypt each one now, once,
        // rather than re-decrypting on every render.
        const decrypted = await Promise.all(
          data.items.map(async (item) => ({
            ...item,
            title: await decryptString(item.encryptedTitle, item.encryptedTitleIv, vaultKey).catch(() => "(couldn't decrypt)")
          }))
        );
        if (!cancelled) setItems(decrypted);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [vaultKey, trash, attempt]);

  async function handleTrashAction(item, permanent) {
    if (permanent && !window.confirm(`Permanently delete "${item.title}"? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (permanent) await api.items.purge(item.id);
      else await api.items.restore(item.id);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setMessage(permanent ? "Item permanently deleted." : "Item restored to All items.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!items && !error) return <p role="status" style={{ padding: 24 }}>Loading items…</p>;

  return (
    <div style={{ padding: "20px 24px" }}>
      {trash && (
        <header className="page-header">
          <h1 className="page-title">Trash</h1>
          <p className="page-subtitle">Items stay encrypted here until you restore or permanently delete them. Nothing is automatically deleted.</p>
        </header>
      )}
      {error && <div className="error-banner" role="alert">
        {error}
        {!items && <button className="btn btn-ghost" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Try again</button>}
      </div>}
      <div role="status">{message}</div>
      {items?.length === 0 && (
        <div className="empty-state">
          <p>{trash ? "Trash is empty." : "No items yet."}</p>
          <Link to={trash ? "/" : "/items/new"} className="btn btn-primary">
            {trash ? "All items" : "Add your first item"}
          </Link>
        </div>
      )}
      <div className="item-list">
        {items?.map((item) => {
          const Icon = TYPE_ICON[item.type] || KeyGlyph;
          if (trash) {
            return (
              <div key={item.id} className="item-row trash-row">
                <span className="item-row-icon"><Icon size={17} /></span>
                <div className="trash-item-title">
                  <div className="item-row-title">{item.title}</div>
                  <div className="item-row-type">{item.type}</div>
                </div>
                <div className="trash-actions">
                  <button className="btn btn-ghost" disabled={busy} onClick={() => handleTrashAction(item, false)} aria-label={`Restore ${item.title}`}>Restore</button>
                  <button className="btn btn-danger-ghost" disabled={busy} onClick={() => handleTrashAction(item, true)} aria-label={`Permanently delete ${item.title}`}>Delete forever</button>
                </div>
              </div>
            );
          }
          return (
            <Link key={item.id} to={`/items/${item.id}`} className="item-row">
              <span className="item-row-icon">
                <Icon size={17} />
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <div className="item-row-title">{item.title}</div>
                <div className="item-row-type">{item.type}</div>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
