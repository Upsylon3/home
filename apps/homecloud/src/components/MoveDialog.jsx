import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import { api } from "../api.js";

const selectStyle = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "10px 12px",
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "var(--font-mono)"
};

// Builds an indented flat list from a parentId-linked folder tree, so a
// plain <select> can represent nesting depth without needing a real tree
// widget.
function buildIndentedOptions(folders) {
  const byParent = new Map();
  for (const f of folders) {
    const key = f.parentId ?? "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  }
  const options = [];
  function walk(parentKey, depth) {
    const children = (byParent.get(parentKey) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      options.push({ id: child.id, label: `${"\u2014 ".repeat(depth)}${child.name}` });
      walk(child.id, depth + 1);
    }
  }
  walk("root", 0);
  return options;
}

export default function MoveDialog({ title, onClose, onMove }) {
  const [folders, setFolders] = useState([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.folders
      .listAll()
      .then(({ data }) => setFolders(data.folders))
      .catch((err) => setError(err.message));
  }, []);

  async function handleMove() {
    setLoading(true);
    setError("");
    try {
      await onMove(selected ? Number(selected) : null);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const options = buildIndentedOptions(folders);

  return (
    <Modal title={title} onClose={onClose}>
      {error && <div className="error-banner">{error}</div>}
      <div className="field">
        <label htmlFor="destFolder">Destination</label>
        <select id="destFolder" value={selected} onChange={(e) => setSelected(e.target.value)} style={selectStyle}>
          <option value="">Home (root)</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <button className="btn btn-primary" onClick={handleMove} disabled={loading}>
        {loading ? "Moving…" : "Move"}
      </button>
    </Modal>
  );
}
