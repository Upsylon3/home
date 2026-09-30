FROM node:26-slim

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

# Port 4500, continuing the 4000/4200/4300/4400 pattern used by
# HomeCore/HomeMedia/HomeSync/HomeNotes. Not published to the host —
# only the gateway does that (see docker-compose.yml's `expose` vs
# `ports`).
EXPOSE 4500

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4500/api/homecloud/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
