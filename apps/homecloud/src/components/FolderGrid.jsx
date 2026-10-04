// FolderGrid — the folders shown above the file list, drawn as little
// game "cartridges" on a shelf. Each one has a striped label along its top
// edge, like the label on an Atari cartridge.
//
// All of the looks live in CSS (.folder-grid and .folder-card in
// styles/index.css). This used to be styled with inline `style={{...}}`
// objects, which cannot react to the theme, to hover, or to the retro
// intensity setting. Class names can, so the styling moved to CSS and this
// component now only describes the structure.
export default function FolderGrid({ folders, onOpen, onRename, onDelete }) {
  // Nothing to show: render nothing at all (not even an empty box).
  if (folders.length === 0) return null;

  return (
    <div className="folder-grid">
      {folders.map((f) => (
        <div key={f.id} className="folder-card">
          {/* The main button: opens the folder. */}
          <button type="button" className="folder-open" onClick={() => onOpen(f.id)}>
            <span className="folder-arrow" aria-hidden="true">▸</span> {f.name}
          </button>

          {/* Small secondary actions. aria-label tells screen readers which
              folder each ✎ / ✕ belongs to (a bare "✎" says nothing). */}
          <button
            type="button"
            className="folder-action"
            onClick={() => onRename(f)}
            title="Rename folder"
            aria-label={`Rename ${f.name}`}
          >
            ✎
          </button>
          <button
            type="button"
            className="folder-action folder-action-danger"
            onClick={() => onDelete(f)}
            title="Delete folder"
            aria-label={`Delete ${f.name}`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
