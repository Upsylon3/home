#!/bin/sh
set -eu
cd -- "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
action=${1:-start}
case "$action" in start|code|access|stop|status|logs) ;; *) echo 'Usage: ./home.sh [start|code|access|stop|status|logs]' >&2; exit 1 ;; esac
command -v docker >/dev/null 2>&1 || { echo 'Install Docker Engine with Compose (Linux) or Docker Desktop (macOS), then run HOME again. See START-HERE.md.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Start Docker, select Linux containers if applicable, and try again.' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo 'Docker Compose v2 is required. See START-HERE.md.' >&2; exit 1; }
case "$action" in
  stop) docker compose -f compose.json stop; exit ;;
  status) docker compose -f compose.json ps; exit ;;
  logs) docker compose -f compose.json logs --tail 100; exit ;;
esac
image=$(cat installer-image.txt)
if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo 'Loading the included HOME containers. This may take a few minutes.'
  docker load -i images.tar
fi
network=''
if [ "$action" = access ]; then
  # An old public listener must stop even when the new profile is disabled.
  docker compose -f compose.json stop tls
  network='home-server_default'
fi
if [ -n "$network" ]; then
  docker run --rm -it --user "$(id -u):$(id -g)" --network "$network" --mount "type=bind,source=$(pwd),target=/bundle" --entrypoint node "$image" /bundle/setup/cli.mjs "$action"
else
  docker run --rm -it --user "$(id -u):$(id -g)" --mount "type=bind,source=$(pwd),target=/bundle" --entrypoint node "$image" /bundle/setup/cli.mjs "$action"
fi
if [ "$action" != code ]; then
  docker compose -f compose.json up -d --wait --wait-timeout 180 --remove-orphans
  echo 'HOME is running. Open http://localhost:8080 on this computer. Use ./home.sh status to check services.'
  if grep -q '"mode": "lan"' configuration/installation.json; then
    echo 'For another device at home, use your Wi-Fi/Ethernet address with :8080. Candidate addresses:'
    if [ "$(uname -s)" = Darwin ]; then
      ipconfig getifaddr en0 || ipconfig getifaddr en1 || true
    else
      hostname -I || true
    fi
  fi
fi
