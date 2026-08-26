FROM node:20-slim

# better-sqlite3 is a native module; these build tools are a safety net
# in case a prebuilt binary isn't available for your platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV DATA_DIR=/data
VOLUME ["/data"]

# Not published anywhere yet — see MIGRATION_PLAN.md's Phase 1: this
# service isn't wired into docker-compose.yml or the gateway until Phase
# 5, once it actually does something. Port chosen now (continuing the
# existing 4000/4200/4300/4400 pattern) so nothing needs renumbering later.
EXPOSE 4500

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4500/api/homecloud/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
