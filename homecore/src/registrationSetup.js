const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { db, DATA_DIR } = require("./db");

// Consumption and account creation share the caller's immediate transaction.
// Remember consumed hashes even if an old setup file is restored or replayed.
db.exec(`CREATE TABLE IF NOT EXISTS hc_registration_claims (
  code_hash TEXT PRIMARY KEY,
  consumed_at INTEGER NOT NULL
)`);

function requiresSetupCode() {
  return process.env.HOME_SETUP_REQUIRED === "true";
}

function consumeSetupCode(candidate) {
  if (!requiresSetupCode()) return true;
  if (typeof candidate !== "string") return false;
  const code = candidate.replace(/[-\s]/g, "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(code)) return false;
  try {
    const file = path.join(DATA_DIR, "registration-code.json");
    if (fs.statSync(file).size > 4096) return false;
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    const now = Date.now();
    if (!/^[a-f0-9]{64}$/.test(record.hash) || !Number.isSafeInteger(record.expiresAt) ||
        !Number.isSafeInteger(record.issuedAt) || record.issuedAt > now ||
        record.expiresAt <= now || record.expiresAt - record.issuedAt > 15 * 60_000) return false;
    const hash = crypto.createHash("sha256").update(code).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(record.hash, "hex"))) return false;
    const result = db.prepare("INSERT OR IGNORE INTO hc_registration_claims (code_hash, consumed_at) VALUES (?, ?)").run(hash, now);
    return result.changes === 1;
  } catch {
    // Missing, malformed or unreadable setup state must never open registration.
    return false;
  }
}

module.exports = { requiresSetupCode, consumeSetupCode };
