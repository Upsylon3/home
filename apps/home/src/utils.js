export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Relative-time labels for activity/notification feeds ("2m ago", "3h ago").
// Falls back to a plain date once it's more than a week old, since "312h
// ago" stops being useful information at that point.
export function timeAgo(isoLike) {
  if (!isoLike) return "";
  // SQLite's datetime('now') returns "YYYY-MM-DD HH:MM:SS" (UTC, no
  // timezone suffix), which Date() would otherwise parse as local time.
  const iso = isoLike.includes("T") ? isoLike : `${isoLike.replace(" ", "T")}Z`;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000));

  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Turns "homecloud.file.uploaded" into "uploaded a file" — readable prose
// for the activity feed instead of raw event-type strings. Anything not
// explicitly listed falls back to the raw type with dots turned to spaces,
// so a new, not-yet-mapped event still reads as *something* sensible
// rather than being hidden.
const EVENT_LABELS = {
  "homecloud.file.uploaded": "uploaded a file",
  "homecloud.file.moved": "moved a file",
  "homecloud.file.downloaded": "downloaded files",
  "homecloud.file.share_created": "created a share link",
  "homecloud.file.share_revoked": "revoked a share link",
  "homecloud.file.deleted": "deleted a file",
  "homecloud.file.restored": "restored a file",
  "homecloud.file.purged": "permanently deleted a file",
  "homecloud.folder.created": "created a folder",
  "homecloud.folder.renamed": "renamed a folder",
  "homecloud.folder.deleted": "deleted a folder",
  "homecloud.user.login_2fa": "signed in",
  "homecloud.user.login_2fa_recovery": "signed in with a recovery code",
  "homecloud.user.password_changed": "changed their password",
  "homecloud.user.logout_everywhere": "signed out of every device",
  "homecloud.user.2fa_enabled": "enabled two-factor authentication",
  "homecloud.user.2fa_disabled": "disabled two-factor authentication",
  "homecloud.user.2fa_recovery_codes_regenerated": "regenerated recovery codes",
  "homecloud.admin.password_reset": "reset a user's password",
  "homecloud.admin.user_disabled": "disabled a user",
  "homecloud.admin.user_enabled": "enabled a user",
  "homecloud.admin.quota_changed": "changed a user's quota",
  "homecloud.admin.user_promoted": "promoted a user to admin",
  "homecloud.admin.user_demoted": "removed a user's admin role",
  "homecloud.admin.2fa_disabled": "disabled a user's two-factor authentication"
};

export function describeEvent(event) {
  const label = EVENT_LABELS[event.eventType] || event.eventType.split(".").slice(1).join(" ");
  return event.targetId ? `${label} — ${event.targetId}` : label;
}
