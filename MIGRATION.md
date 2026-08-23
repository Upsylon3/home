# Tiered architecture migration

## Layout
- `gateway/` is Tier 0 request routing.
- `homecore/` is Tier 0 platform code, deliberately embedded in the former HomeCloud backend for v0.
- `apps/home/` is the main Home shell at `/`.
- `apps/homecloud/`, `apps/homemedia/`, `apps/homenotes/`, and HomeSync are Tier 1 applications.
- `services/` contains infrastructure/operational services. A future optional `services/homebridge/` belongs to Tier 2.

## Public entry point
Only the gateway publishes a host port. Start with `docker compose up --build` and open `http://localhost:8080/`.

## Important compatibility note
The existing persistent Docker volume name/data format is intentionally preserved as `homecloud_data`; moving its owner in the source tree does not migrate or duplicate user data.
