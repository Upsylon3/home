# Built from the REPOSITORY ROOT, not this folder — see the `build:` entry for
# this service in docker-compose.yml. The repo is one npm workspace with a
# single package-lock.json at the root, which a build limited to apps/homevault/
# could not see.

# ---- Stage 1: compile the React app into plain HTML/CSS/JS
FROM node:22-slim AS build
WORKDIR /app

# The whole repo (minus .dockerignore): npm needs every workspace's
# package.json present to check the lockfile is consistent.
COPY . .

# Exactly the locked versions, only for this app. Dev dependencies ARE
# needed here (Vite compiles the app), unlike in the backend images.
RUN npm ci --workspace=apps/homevault

WORKDIR /app/apps/homevault
RUN npm run build

# ---- Stage 2: serve the compiled files with nginx (no Node in the final image)
FROM nginx:1.30-alpine
COPY --from=build /app/apps/homevault/dist /usr/share/nginx/html
COPY apps/homevault/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
