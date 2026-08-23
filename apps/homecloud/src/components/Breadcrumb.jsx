const crumbStyle = (active) => ({
  background: "none",
  border: "none",
  color: active ? "var(--text)" : "var(--amber)",
  cursor: active ? "default" : "pointer",
  padding: 0,
  fontFamily: "var(--font-mono)",
  fontSize: 13
});

export default function Breadcrumb({ trail, onNavigate }) {
  return (
    <div style={{ marginBottom: 16, color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
      <button style={crumbStyle(trail.length === 0)} onClick={() => onNavigate(null)} disabled={trail.length === 0}>
        Home
      </button>
      {trail.map((seg, i) => (
        <span key={seg.id}>
          {" / "}
          <button
            style={crumbStyle(i === trail.length - 1)}
            onClick={() => onNavigate(seg.id)}
            disabled={i === trail.length - 1}
          >
            {seg.name}
          </button>
        </span>
      ))}
    </div>
  );
}
