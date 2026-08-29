FROM node:20-slim

# better-sqlite3 is a native module; these build tools are a safety net
# in case a prebuilt binary isn't available for your platform. Same
# reasoning as every other Dockerfile in this repo that uses it.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY scripts/migrate-legacy-homecloud-data.js ./
RUN npm install better-sqlite3@^11.3.0

ENTRYPOINT ["node", "migrate-legacy-homecloud-data.js"]
