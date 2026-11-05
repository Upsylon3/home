const { randomUUID } = require('node:crypto');

// Separate from local numeric IDs and JWT subjects. Retain deleted identities as
// tombstones so a later account cannot inherit a foreign grant.
function ensureAccountSubjects(db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hc_account_subjects (
        subject TEXT PRIMARY KEY NOT NULL,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TRIGGER IF NOT EXISTS hc_subject_immutable
      BEFORE UPDATE ON hc_account_subjects
      WHEN NEW.subject != OLD.subject OR NEW.user_id IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'Account subjects are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS hc_subject_retained
      BEFORE DELETE ON hc_account_subjects
      BEGIN SELECT RAISE(ABORT, 'Account subjects must be retained'); END;
      CREATE TRIGGER IF NOT EXISTS hc_subject_created
      AFTER INSERT ON users BEGIN
        INSERT INTO hc_account_subjects (user_id, subject) VALUES (NEW.id,
          lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
          substr(lower(hex(randomblob(2))), 2) || '-' ||
          substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) ||
          '-' || lower(hex(randomblob(6))));
      END;
      CREATE TABLE IF NOT EXISTS hc_peer_namespace (
        id INTEGER PRIMARY KEY CHECK (id = 1), namespace_id TEXT NOT NULL UNIQUE
      );
      CREATE TRIGGER IF NOT EXISTS hc_peer_namespace_immutable
      BEFORE UPDATE ON hc_peer_namespace
      BEGIN SELECT RAISE(ABORT, 'Peer namespace is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS hc_peer_namespace_retained
      BEFORE DELETE ON hc_peer_namespace
      BEGIN SELECT RAISE(ABORT, 'Peer namespace must be retained'); END;
    `);
    const insert = db.prepare('INSERT INTO hc_account_subjects (user_id, subject) VALUES (?, ?)');
    for (const user of db.prepare(`SELECT u.id FROM users u LEFT JOIN hc_account_subjects s
      ON s.user_id = u.id WHERE s.subject IS NULL`).all()) insert.run(user.id, randomUUID());
    db.prepare('INSERT OR IGNORE INTO hc_peer_namespace (id, namespace_id) VALUES (1, ?)').run(randomUUID());
  }).immediate();
}

module.exports = { ensureAccountSubjects };
