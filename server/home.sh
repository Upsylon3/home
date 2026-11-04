#!/bin/sh
set -eu
cd -- "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
action=${1:-start}
case "$action" in start|code|access|stop|status|logs|upgrade) ;; *) echo 'Usage: ./home.sh [start|code|access|stop|status|logs|upgrade OLD-FOLDER]' >&2; exit 1 ;; esac
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
if [ "$action" = upgrade ]; then
  [ "$#" -eq 2 ] || { echo 'Usage: ./home.sh upgrade /path/to/old-home-folder' >&2; exit 1; }
  previous=$(CDPATH= cd -P -- "$2" && pwd -P)
  current=$(pwd -P)
  case "$previous/" in "$current/"*) echo 'Old and new folders must be separate and non-nested.' >&2; exit 1 ;; esac
  case "$current/" in "$previous/"*) echo 'Old and new folders must be separate and non-nested.' >&2; exit 1 ;; esac
  case "$previous$current" in *,*) echo 'Installation paths must not contain commas.' >&2; exit 1 ;; esac
  project=$(docker run --rm --mount "type=bind,source=$current,target=/bundle" --mount "type=bind,source=$previous,target=/previous,readonly" --entrypoint node "$image" /bundle/setup/cli.mjs check-upgrade)
  if [ "$project" != complete ]; then
    case "$project" in home-server-????????-????-????-????-????????????) ;; *) echo 'Invalid upgrade project.' >&2; exit 1 ;; esac
    containers=$(docker ps -aq --filter "label=com.docker.compose.project=$project")
    for container in $containers; do
      config_files=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$container")
      [ "$config_files" = "$previous/compose.json" ] || { echo 'This project uses another folder or Compose overrides; migration refused.' >&2; exit 1; }
    done
    echo 'Stopping the old HOME (including optional services) before making a verified copy. Keep both folders private.'
    docker compose --project-name "$project" -f "$previous/compose.json" --profile '*' stop
    running=$(docker ps -q --filter "label=com.docker.compose.project=$project")
    [ -z "$running" ] || { echo 'Some source containers are still running; upgrade refused.' >&2; exit 1; }
    docker run --rm --mount "type=bind,source=$current,target=/bundle" --mount "type=bind,source=$previous,target=/previous,readonly" --entrypoint node "$image" /bundle/setup/cli.mjs upgrade --confirm-stopped
  fi
  docker compose -f compose.json up -d --wait --wait-timeout 180 --remove-orphans
  echo 'HOME upgraded. Use this new folder only. If startup failed, keep the old folder and consult START-HERE.md.'
  exit
fi
network=''
if [ "$action" = access ]; then
  # An old public listener must stop even when the new profile is disabled.
  docker compose -f compose.json stop tls
  core=$(docker compose -f compose.json ps -q homecore)
  [ -n "$core" ] || { echo 'Start HOME before changing access.' >&2; exit 1; }
  network=$(docker inspect --format '{{range $name, $value := .NetworkSettings.Networks}}{{$name}}{{end}}' "$core")
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
