# This image is built from the REPOSITORY ROOT, not from this folder — see the
# `build:` entry for this service in docker-compose.yml.
#
# Why: the repo is an npm workspace. There is ONE package-lock.json, at the
# root, and the shared package @home/homecore-client lives in packages/. A
# build that could only see apps/hometasks-backend/ would find neither.

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
# (and what it depends on) instead of installing every workspace.
# `--omit=dev` skips test-only packages.
RUN npm ci --omit=dev --workspace=apps/hometasks-backend

# ---- Stage 2: the image that actually runs (no compilers, much smaller)
FROM node:22-slim

WORKDIR /app/apps/hometasks-backend

COPY --from=deps /app/node_modules /app/node_modules
# packages/ holds @home/homecore-client, which node_modules/@home links to
# (a shortcut, not a copy), so it has to be present next to node_modules.
COPY --from=deps /app/packages /app/packages
COPY --from=deps /app/apps/hometasks-backend /app/apps/hometasks-backend

ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 4700

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4700/api/hometasks/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
