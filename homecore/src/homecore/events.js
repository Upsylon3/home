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

function listEvents({ limit = 200, actorUserId = null } = {}) {
  const cappedLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const where = actorUserId ? "WHERE e.actor_user_id = ?" : "";
  const params = actorUserId ? [actorUserId, cappedLimit] : [cappedLimit];
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

module.exports = { emitEvent, listEvents };
