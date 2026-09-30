# This image is built from the REPOSITORY ROOT, not from this folder — see the
# `build:` entry for this service in docker-compose.yml.
#
# Why: the repo is an npm workspace. There is ONE package-lock.json, at the
# root. A build that could only see homecore/ would find no lockfile.

# ---- Stage 1: install dependencies (needs compilers, so it's the heavy stage)
FROM node:22-slim AS deps

# better-sqlite3 is a native module; these build tools are a
# safety net in case a prebuilt binary isn't available for your platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The whole repo (minus whatever .dockerignore excludes). npm needs every
# workspace's package.json present to check the lockfile is consistent.
COPY . .

# `npm ci` installs exactly what package-lock.json says, and fails if the
# lockfile and package.json disagree. `--workspace` limits it to this service
# (and what it depends on) instead of installing all twelve.
# `--omit=dev` skips test-only packages.
RUN npm ci --omit=dev --workspace=homecore

# ---- Stage 2: the image that actually runs (no compilers, much smaller)
FROM node:22-slim

WORKDIR /app/homecore

COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/homecore /app/homecore

ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
