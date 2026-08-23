import { useState } from "react";
import Modal from "./Modal.jsx";
import { api } from "../api.js";

export default function ShareDialog({ file, onClose, onShared }) {
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [share, setShare] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.createShare(file.id, expiresInDays);
      setShare(data.share);
      onShared?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy(url) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  const url = share ? api.shareUrl(share.token) : null;

  return (
    <Modal title={`Share "${file.name}"`} onClose={onClose}>
      {!share ? (
        <>
          <p className="auth-subtitle">
            Anyone with this link can download this one file — no account
            needed. You can revoke it any time from the "Shared links" tab.
          </p>
          {error && <div className="error-banner">{error}</div>}
          <div className="field">
            <label htmlFor="expiresInDays">Link expires after</label>
            <select
              id="expiresInDays"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              style={{
                width: "100%",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "10px 12px",
                color: "var(--text)",
                fontSize: 14,
                fontFamily: "var(--font-mono)"
              }}
            >
              <option value={1}>1 day</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={0}>Never</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
            {loading ? "Creating link…" : "Create link"}
          </button>
        </>
      ) : (
        <>
          <p className="auth-subtitle">
            {share.expiresAt ? `Expires ${share.expiresAt} UTC.` : "This link never expires."}
          </p>
          <div className="field">
            <input readOnly value={url} onFocus={(e) => e.target.select()} />
          </div>
          <button className="btn btn-primary" onClick={() => handleCopy(url)}>
            {copied ? "Copied!" : "Copy link"}
          </button>
        </>
      )}
    </Modal>
  );
}
