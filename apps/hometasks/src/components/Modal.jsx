import { useEffect, useRef } from "react";

export default function Modal({ title, onClose, children }) {
  const dialogRef = useRef(null);
  const previousFocus = useRef(document.activeElement);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const controls = [...dialogRef.current.querySelectorAll("button, input, textarea, select, a[href]")].filter(el => !el.disabled && el.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("keydown", handleKeyDown); previousFocus.current?.focus(); };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="auth-card"
        style={{ maxWidth: 420, width: "100%", margin: 0, maxHeight: "calc(100dvh - 40px)", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h1 className="auth-title" style={{ fontSize: 16, marginBottom: 0 }}>{title}</h1>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-dim)",
              fontSize: 18,
              cursor: "pointer",
              lineHeight: 1,
              padding: 4
            }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
