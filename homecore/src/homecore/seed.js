// Seed only the permission catalog. App installation is explicit and persists across restarts.
const { db } = require("../db");

const DEFAULT_PERMISSIONS = [
  ["files.read", "Read file and folder metadata and contents"],
  ["files.write", "Upload, move, and rename files and folders"],
  ["files.delete", "Delete or permanently purge files and folders"],
  ["files.share", "Create and revoke public share links"],
  ["users.read", "View other users' basic account info"],
  ["users.manage", "Create, disable, or modify other users' accounts"],
  ["system.read", "View system health and configuration"],
  ["system.manage", "Change system configuration"],
  ["applications.read", "View the installed application registry"],
  ["applications.manage", "Install, enable, disable, or remove applications"]
];

function seedPermissions() {
  const insert = db.prepare("INSERT OR IGNORE INTO hc_permissions (key, description) VALUES (?, ?)");
  for (const [key, description] of DEFAULT_PERMISSIONS) insert.run(key, description);
}

function runSeed() {
  seedPermissions();
}

module.exports = { runSeed, DEFAULT_PERMISSIONS };
