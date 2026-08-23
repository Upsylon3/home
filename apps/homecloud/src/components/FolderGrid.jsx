export default function FolderGrid({ folders, onOpen, onRename, onDelete }) {
  if (folders.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
      {folders.map((f) => (
        <div
          key={f.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "6px 6px 6px 12px",
            background: "var(--panel)"
          }}
        >
          <button
            onClick={() => onOpen(f.id)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 4px"
            }}
          >
            <span style={{ color: "var(--amber)" }}>▸</span> {f.name}
          </button>
          <button
            onClick={() => onRename(f)}
            title="Rename folder"
            aria-label={`Rename ${f.name}`}
            style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 13, padding: 6 }}
          >
            ✎
          </button>
          <button
            onClick={() => onDelete(f)}
            title="Delete folder"
            aria-label={`Delete ${f.name}`}
            style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 13, padding: 6 }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
