import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useVault } from "../vaultContext.jsx";
import { encryptString, decryptString, encryptJSON, decryptJSON } from "../crypto.js";
import { EyeGlyph, EyeOffGlyph, CopyGlyph, KeyGlyph, NoteGlyph, CardGlyph, TrashGlyph } from "../components/icons.jsx";

const TYPE_ICON = { login: KeyGlyph, note: NoteGlyph, card: CardGlyph };

const EMPTY_DATA = {
  login: { username: "", password: "", url: "", notes: "" },
  note: { body: "" },
  card: { cardholder: "", number: "", expiry: "", cvv: "", notes: "" }
};

function copy(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

export default function ItemDetail() {
  const { itemId } = useParams();
  const isNew = itemId === "new";
  const { vaultKey } = useVault();
  const navigate = useNavigate();

  const [type, setType] = useState("login");
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState(EMPTY_DATA.login);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    async function load() {
      try {
        const { data } = await api.items.get(itemId);
        const decryptedTitle = await decryptString(data.item.encryptedTitle, data.item.encryptedTitleIv, vaultKey);
        const decryptedData = await decryptJSON(data.item.encryptedData, data.item.encryptedDataIv, vaultKey);
        if (!cancelled) {
          setType(data.item.type);
          setTitle(decryptedTitle);
          setFields({ ...EMPTY_DATA[data.item.type], ...decryptedData });
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [itemId, isNew, vaultKey]);

  function changeType(newType) {
    setType(newType);
    setFields(EMPTY_DATA[newType]);
  }

  function updateField(key, value) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Give this item a title.");
      return;
    }
    setSaving(true);
    try {
      const encryptedTitleResult = await encryptString(title.trim(), vaultKey);
      const encryptedDataResult = await encryptJSON(fields, vaultKey);
      const payload = {
        type,
        encryptedTitle: encryptedTitleResult.ciphertext,
        encryptedTitleIv: encryptedTitleResult.iv,
        encryptedData: encryptedDataResult.ciphertext,
        encryptedDataIv: encryptedDataResult.iv
      };
      if (isNew) {
        const { data } = await api.items.create(payload);
        navigate(`/items/${data.item.id}`, { replace: true });
      } else {
        await api.items.update(itemId, payload);
      }
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this item? This can't be undone.")) return;
    try {
      await api.items.remove(itemId);
      navigate("/");
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return null;

  const Icon = TYPE_ICON[type];

  return (
    <div style={{ padding: "20px 24px", maxWidth: 560 }}>
      {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

      {isNew && (
        <div className="type-tabs">
          {Object.keys(EMPTY_DATA).map((t) => {
            const TabIcon = TYPE_ICON[t];
            return (
              <button
                key={t}
                type="button"
                className={`type-tab${type === t ? " active" : ""}`}
                onClick={() => changeType(t)}
              >
                <TabIcon size={14} /> {t}
              </button>
            );
          })}
        </div>
      )}

      <form onSubmit={handleSave}>
        <div className="field">
          <label htmlFor="title">
            <Icon size={13} /> Title
          </label>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        </div>

        {type === "login" && (
          <>
            <div className="field">
              <label htmlFor="username">Username</label>
              <div className="field-with-action">
                <input id="username" value={fields.username} onChange={(e) => updateField("username", e.target.value)} />
                <button type="button" className="icon-btn" onClick={() => copy(fields.username)} aria-label="Copy username">
                  <CopyGlyph size={15} />
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="field-with-action">
                <input
                  id="password"
                  type={showSecret ? "text" : "password"}
                  value={fields.password}
                  onChange={(e) => updateField("password", e.target.value)}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowSecret((v) => !v)}
                  aria-label={showSecret ? "Hide password" : "Show password"}
                >
                  {showSecret ? <EyeOffGlyph size={15} /> : <EyeGlyph size={15} />}
                </button>
                <button type="button" className="icon-btn" onClick={() => copy(fields.password)} aria-label="Copy password">
                  <CopyGlyph size={15} />
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="url">Website</label>
              <input id="url" value={fields.url} onChange={(e) => updateField("url", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" rows={3} value={fields.notes} onChange={(e) => updateField("notes", e.target.value)} />
            </div>
          </>
        )}

        {type === "note" && (
          <div className="field">
            <label htmlFor="body">Note</label>
            <textarea id="body" rows={10} value={fields.body} onChange={(e) => updateField("body", e.target.value)} />
          </div>
        )}

        {type === "card" && (
          <>
            <div className="field">
              <label htmlFor="cardholder">Cardholder name</label>
              <input id="cardholder" value={fields.cardholder} onChange={(e) => updateField("cardholder", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="number">Card number</label>
              <div className="field-with-action">
                <input
                  id="number"
                  type={showSecret ? "text" : "password"}
                  value={fields.number}
                  onChange={(e) => updateField("number", e.target.value)}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowSecret((v) => !v)}
                  aria-label={showSecret ? "Hide number" : "Show number"}
                >
                  {showSecret ? <EyeOffGlyph size={15} /> : <EyeGlyph size={15} />}
                </button>
                <button type="button" className="icon-btn" onClick={() => copy(fields.number)} aria-label="Copy card number">
                  <CopyGlyph size={15} />
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="expiry">Expiry</label>
              <input id="expiry" placeholder="MM/YY" value={fields.expiry} onChange={(e) => updateField("expiry", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="cvv">CVV</label>
              <input
                id="cvv"
                type={showSecret ? "text" : "password"}
                value={fields.cvv}
                onChange={(e) => updateField("cvv", e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="cardNotes">Notes</label>
              <textarea id="cardNotes" rows={3} value={fields.notes} onChange={(e) => updateField("notes", e.target.value)} />
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => navigate("/")}>
            Cancel
          </button>
          {!isNew && (
            <button className="btn-danger-ghost btn" type="button" onClick={handleDelete} style={{ marginLeft: "auto" }}>
              <TrashGlyph size={14} /> Delete
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
