import { useState } from "react";
import { Link, useParams } from "react-router-dom";

function buildChildrenMap(folders) {
  const byParent = new Map();
  for (const f of folders) {
    const key = f.parentId ?? "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return byParent;
}

export default function FolderTree({ folders }) {
  const { folderId } = useParams();
  const [expanded, setExpanded] = useState(() => new Set());
  const childrenMap = buildChildrenMap(folders);

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderLevel(parentKey) {
    const children = childrenMap.get(parentKey) || [];
    if (children.length === 0) return null;

    return (
      <ul className="folder-tree">
        {children.map((folder) => {
          const hasChildren = (childrenMap.get(folder.id) || []).length > 0;
          const isExpanded = expanded.has(folder.id);
          const isActive = String(folder.id) === folderId;

          return (
            <li key={folder.id} className="folder-tree-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggle(folder.id)}
                    aria-label={isExpanded ? "Collapse" : "Expand"}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-dim)",
                      cursor: "pointer",
                      padding: "0 2px",
                      fontSize: 10,
                      width: 16,
                      flexShrink: 0
                    }}
                  >
                    {isExpanded ? "▾" : "▸"}
                  </button>
                ) : (
                  <span style={{ width: 16, flexShrink: 0 }} />
                )}
                <Link to={`/folders/${folder.id}`} className={`folder-tree-row${isActive ? " active" : ""}`}>
                  <span className="name">{folder.name}</span>
                </Link>
              </div>
              {hasChildren && isExpanded && <div className="folder-tree-children">{renderLevel(folder.id)}</div>}
            </li>
          );
        })}
      </ul>
    );
  }

  return renderLevel("root");
}
