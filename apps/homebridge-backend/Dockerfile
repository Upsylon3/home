FROM node:26-slim AS deps
WORKDIR /app
COPY . .
RUN npm ci --omit=dev --workspace=apps/homebridge-backend

FROM node:26-slim
WORKDIR /app/apps/homebridge-backend
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/packages /app/packages
COPY --from=deps /app/apps/homebridge-backend /app/apps/homebridge-backend
ENV PORT=4900
EXPOSE 4900
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4900/api/homebridge/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
