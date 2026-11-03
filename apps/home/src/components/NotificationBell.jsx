import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { timeAgo } from "../utils.js";
import { BellGlyph } from "./icons.jsx";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    let active = true;
    let refreshing = false;
    async function refresh() {
      if (refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      try {
        const { data } = await api.notifications.list();
        if (active) { setNotifications(data.notifications); setRefreshFailed(false); }
      } catch {
        if (active) setRefreshFailed(true); // Retain the last successful list during an outage.
      } finally { refreshing = false; if (active) setLoaded(true); }
    }
    refresh();
    const timer = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleEscape(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => { document.removeEventListener("mousedown", handleClickOutside); document.removeEventListener("keydown", handleEscape); };
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
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Notifications" aria-expanded={open}>
        <BellGlyph />
        {unreadCount > 0 && <span className="badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          {refreshFailed && <div className="empty-state" role="status">Could not refresh notifications. Retrying automatically.</div>}
          {!loaded ? (
            <div className="empty-state">Loading…</div>
          ) : notifications.length === 0 ? (
            <div className="empty-state">
              <span className="glyph">·</span>
              {refreshFailed ? "No saved notifications to show." : "Nothing yet. When an application has something for you, it'll show up here."}
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`notif-item${n.readAt ? "" : " unread"}`}
              >
                <button type="button" className="notif-read" onClick={() => handleOpenNotification(n)}>
                  <span className="notif-item-title">{n.title}</span>
                  {n.body && <span className="notif-item-body">{n.body}</span>}
                </button>
                {n.applicationSlug === "hometasks" && Number.isSafeInteger(n.data?.taskId) && n.data.taskId > 0 && <a href={`/tasks/all?task=${n.data.taskId}`} onClick={() => handleOpenNotification(n)}>Open task</a>}
                <div className="notif-item-time">{timeAgo(n.createdAt)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
