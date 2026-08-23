export function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatDate(isoString) {
  const d = new Date(isoString.replace(" ", "T") + (isoString.endsWith("Z") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export const ACTION_LABELS = {
  upload: "Uploaded",
  delete: "Moved to trash",
  restore: "Restored from trash",
  permanent_delete: "Permanently deleted",
  move: "Moved",
  folder_create: "Created folder",
  folder_rename: "Renamed folder",
  folder_delete: "Deleted folder",
  download_batch: "Downloaded a zip of",
  share_create: "Created a share link for",
  share_revoke: "Revoked a share link for",
  password_change: "Changed password",
  logout_everywhere: "Signed out of all devices",
  admin_reset_password: "Reset the password for",
  admin_disable: "Disabled the account",
  admin_enable: "Re-enabled the account",
  admin_set_quota: "Changed the storage quota for",
  admin_promote: "Made an admin:",
  admin_demote: "Removed admin from",
  admin_disable_2fa: "Force-disabled two-factor authentication for",
  "2fa_enable": "Turned on two-factor authentication",
  "2fa_disable": "Turned off two-factor authentication",
  "2fa_login": "Logged in with a two-factor code",
  "2fa_recovery_login": "Logged in with a recovery code",
  "2fa_recovery_codes_regenerated": "Generated new recovery codes"
};

export function describeActivity(entry) {
  const label = ACTION_LABELS[entry.action] || entry.action;
  return entry.targetName ? `${label} "${entry.targetName}"` : label;
}
