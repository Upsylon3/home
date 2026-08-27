// HomeCore v0 — event emission and querying.
//
// This module only depends on the base db connection (`../db`), not on
// homecore/db.js, so requiring it never triggers HomeCore's schema setup by
// itself — that happens explicitly via homecore/db.js, which is required
// once from homecore/index.js before anything else in HomeCore runs.
//
// HOME_MASTER_SPECIFICATION.md §11 asks for "a simple internal event bus
// initially" and explicitly warns against Kafka/RabbitMQ-style
// infrastructure at this stage. For v0, "the bus" is just: write a row to
// hc_activity_events. There's exactly one consumer right now (the audit
// feed), so an in-process pub/sub layer on top of that would be speculative
// complexity per Rule 4 — this can grow into one later if a second consumer
// (e.g. HomeMedia reacting to homecloud.file.created) actually needs it.
const { db } = require("../db");

// Translates HomeCloud's existing activity_log-era action strings (see
// auth.js, admin.js, and — since MIGRATION_PLAN.md's Phase 2 —
// apps/homecloud-backend's files.js/folders.js) into namespaced HomeCore
// event types, per HOME_MASTER_SPECIFICATION.md §7.6 / §11 (e.g.
// "homecloud.file.uploaded"). Anything not explicitly listed still gets a
// generic "homecloud.<action>" type instead of being silently dropped, so
// a new HomeCloud action shows up in the HomeCore audit trail automatically
// even before this map is updated.
//
// Moved here from ./db.js in MIGRATION_PLAN.md's Phase 3 — toEventType is
// now needed by two callers (the in-process onActivity bridge below, and
// the new POST /internal/events route apps/homecloud-backend's split-out
// logActivity() calls into), and toAction's whole job is being the exact
// inverse of this map, so both belong next to the map they're built from
// rather than duplicated in each caller.
const ACTION_EVENT_MAP = {
  upload: "homecloud.file.uploaded",
  move: "homecloud.file.moved",
  download_batch: "homecloud.file.downloaded",
  share_create: "homecloud.file.share_created",
  share_revoke: "homecloud.file.share_revoked",
  delete: "homecloud.file.deleted",
  restore: "homecloud.file.restored",
  permanent_delete: "homecloud.file.purged",
  folder_create: "homecloud.folder.created",
  folder_rename: "homecloud.folder.renamed",
  folder_delete: "homecloud.folder.deleted",
  "2fa_login": "homecloud.user.login_2fa",
  "2fa_recovery_login": "homecloud.user.login_2fa_recovery",
  password_change: "homecloud.user.password_changed",
  logout_everywhere: "homecloud.user.logout_everywhere",
  "2fa_enable": "homecloud.user.2fa_enabled",
  "2fa_disable": "homecloud.user.2fa_disabled",
  "2fa_recovery_codes_regenerated": "homecloud.user.2fa_recovery_codes_regenerated",
  admin_reset_password: "homecloud.admin.password_reset",
  admin_disable: "homecloud.admin.user_disabled",
  admin_enable: "homecloud.admin.user_enabled",
  admin_set_quota: "homecloud.admin.quota_changed",
  admin_promote: "homecloud.admin.user_promoted",
  admin_demote: "homecloud.admin.user_demoted",
  admin_disable_2fa: "homecloud.admin.2fa_disabled"
};

const HOMECLOUD_PREFIX = "homecloud.";

function toEventType(action) {
  return ACTION_EVENT_MAP[action] || `${HOMECLOUD_PREFIX}${action}`;
}

// The exact inverse of the map above, built once from it rather than
// maintained by hand a second time. Exists purely so the two pre-HomeCore
// routes that used to read activity_log directly — GET /api/activity (now
// ./homecloudActivity.js) and GET /api/admin/activity (admin.js) — can go
// on returning the exact {action, targetName, createdAt} shape their
// frontends (apps/homecloud's Settings.jsx and Admin.jsx, via
// describeActivity()/ACTION_LABELS) have always expected, now sourced from
// hc_activity_events instead. Every action string either app ever actually
// logs is a key in ACTION_EVENT_MAP (checked directly against every
// logActivity() call site), so this reverse lookup is total for real data;
// the prefix-strip fallback below only matters for a hypothetical future
// action nobody's added to the map yet, mirroring toEventType's own
// fallback in reverse.
const EVENT_TYPE_TO_ACTION = Object.fromEntries(
  Object.entries(ACTION_EVENT_MAP).map(([action, eventType]) => [eventType, action])
);

function toAction(eventType) {
  if (EVENT_TYPE_TO_ACTION[eventType]) return EVENT_TYPE_TO_ACTION[eventType];
  return eventType.startsWith(HOMECLOUD_PREFIX) ? eventType.slice(HOMECLOUD_PREFIX.length) : eventType;
}

function emitEvent({ actorUserId = null, applicationId = null, eventType, targetType = null, targetId = null, metadata = null }) {
  if (!eventType) {
    throw new Error("emitEvent requires an eventType");
  }
  db.prepare(
    `INSERT INTO hc_activity_events (actor_user_id, application_id, event_type, target_type, target_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    actorUserId,
    applicationId,
    eventType,
    targetType,
    targetId,
    metadata ? JSON.stringify(metadata) : null
  );
}

// applicationId is new in Phase 3 — needed so ./homecloudActivity.js (the
// old per-user GET /api/activity) and admin.js's GET /api/admin/activity
// can both scope the shared, cross-app hc_activity_events table back down
// to "just HomeCloud's own events," matching what activity_log always
// held (only ever written by auth.js/files.js/folders.js/admin.js).
// GET /api/core/activity(/me) deliberately keep passing no applicationId —
// that feed is meant to be cross-app by design (see its own file's header
// comment).
function listEvents({ limit = 200, actorUserId = null, applicationId = null } = {}) {
  const cappedLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const conditions = [];
  const params = [];
  if (actorUserId) {
    conditions.push("e.actor_user_id = ?");
    params.push(actorUserId);
  }
  if (applicationId) {
    conditions.push("e.application_id = ?");
    params.push(applicationId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(cappedLimit);
  return db
    .prepare(
      `SELECT
         e.id,
         e.event_type AS eventType,
         e.target_type AS targetType,
         e.target_id AS targetId,
         e.metadata_json AS metadataJson,
         e.created_at AS createdAt,
         u.username AS actorUsername,
         a.slug AS applicationSlug
       FROM hc_activity_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
       LEFT JOIN hc_applications a ON a.id = e.application_id
       ${where}
       ORDER BY e.created_at DESC
       LIMIT ?`
    )
    .all(...params)
    .map((row) => ({
      id: row.id,
      eventType: row.eventType,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null,
      createdAt: row.createdAt,
      actorUsername: row.actorUsername,
      applicationSlug: row.applicationSlug
    }));
}

module.exports = { emitEvent, listEvents, toEventType, toAction };
