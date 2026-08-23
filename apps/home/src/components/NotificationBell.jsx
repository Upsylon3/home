import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { timeAgo } from "../utils.js";
import { BellGlyph } from "./icons.jsx";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    api.notifications
      .list()
      .then(({ data }) => setNotifications(data.notifications))
      .catch(() => {
        // Notifications are a nice-to-have on the dashboard, not something
        // that should block or error the whole page if it fails to load.
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  async function handleOpenNotification(n) {
    if (!n.readAt) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      try {
        await api.notifications.markRead(n.id);
      } catch {
        // Non-fatal — worst case it shows as unread again on next load.
      }
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        <BellGlyph />
        {unreadCount > 0 && <span className="badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          {!loaded ? (
            <div className="empty-state">Loading…</div>
          ) : notifications.length === 0 ? (
            <div className="empty-state">
              <span className="glyph">·</span>
              Nothing yet. When an application has something for you, it'll show up here.
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`notif-item${n.readAt ? "" : " unread"}`}
                onClick={() => handleOpenNotification(n)}
              >
                <p className="notif-item-title">{n.title}</p>
                {n.body && <p className="notif-item-body">{n.body}</p>}
                <div className="notif-item-time">{timeAgo(n.createdAt)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
