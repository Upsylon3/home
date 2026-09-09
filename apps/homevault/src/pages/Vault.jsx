import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useVault } from "../vaultContext.jsx";
import { decryptString } from "../crypto.js";
import { KeyGlyph, NoteGlyph, CardGlyph } from "../components/icons.jsx";

const TYPE_ICON = { login: KeyGlyph, note: NoteGlyph, card: CardGlyph };

export default function Vault() {
  const { vaultKey } = useVault();
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data } = await api.items.list();
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
  }, [vaultKey]);

  if (error) return <div className="error-banner" style={{ margin: 24 }}>{error}</div>;
  if (!items) return null;

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p>No items yet.</p>
        <Link to="/items/new" className="btn btn-primary">
          Add your first item
        </Link>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 24px" }}>
      <div className="item-list">
        {items.map((item) => {
          const Icon = TYPE_ICON[item.type] || KeyGlyph;
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
