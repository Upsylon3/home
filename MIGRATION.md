# Tiered architecture migration

## Layout
- `gateway/` is Tier 0 request routing.
- `homecore/` is the real, separated Tier 0 platform — identity, sessions,
  permissions, the application registry, and cross-app events/audit. It
  no longer embeds file/folder/share storage — see `MIGRATION_PLAN.md`'s
  Phase 2/5 for how that separation actually happened, not just got
  renamed.
- `apps/home/` is the main Home shell at `/`.
- `apps/homecloud/` + `apps/homecloud-backend/`, `apps/homemedia/` +
  `apps/homemedia-backend/`, `apps/homenotes/` + `apps/homenotes-backend/`,
  and HomeSync are Tier 1 applications — each with its own backend, own
  database, own process.
- `services/` contains infrastructure/operational services. A future
  optional `services/homebridge/` belongs to Tier 2.

## Public entry point
Only the gateway publishes a host port. Start with `docker compose up --build` and open `http://localhost:8080/`.

## Important compatibility note
`homecloud_data` keeps its historically-preserved volume name (now
holding HomeCore's own data — identity, sessions), and `apps/homecloud-backend`
gets its own separate volume, `homecloud_backend_data`. Moving code
between source directories never migrates data on its own — for an
existing deployment with real files already uploaded, see
`docs/SETUP.md`'s "Upgrading an existing install past v0.9.0" and
`scripts/migrate-legacy-homecloud-data.js` for the real, tested mechanism
that actually does that copy.
