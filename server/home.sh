#!/bin/sh
set -eu
cd -- "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
action=${1:-start}
case "$action" in start|code|access|diagnose|stop|status|logs|upgrade|import) ;; *) echo 'Usage: ./home.sh [start|code|access|diagnose|stop|status|logs|upgrade OLD-FOLDER|import SOURCE-FOLDER]' >&2; exit 1 ;; esac
command -v docker >/dev/null 2>&1 || { echo 'Install Docker Engine with Compose (Linux) or Docker Desktop (macOS), then run HOME again. See START-HERE.md.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Start Docker, select Linux containers if applicable, and try again.' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo 'Docker Compose v2 is required. See START-HERE.md.' >&2; exit 1; }
case "$action" in
  stop) docker compose -f compose.json stop; exit ;;
  status) docker compose -f compose.json ps; exit ;;
  logs) docker compose -f compose.json logs --tail 100; exit ;;
esac
image=$(cat installer-image.txt)
if [ "$action" = diagnose ]; then
  core=$(docker compose -f compose.json ps -q homecore)
  [ -n "$core" ] || { echo 'Start HOME before running diagnostics.' >&2; exit 1; }
  network=$(docker inspect --format '{{range $name, $value := .NetworkSettings.Networks}}{{$name}}{{end}}' "$core")
  [ -n "$network" ] || { echo 'Could not find this HOME network.' >&2; exit 1; }
  docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges --network "$network" --mount "type=bind,source=$(pwd),target=/bundle,readonly" --entrypoint node "$image" /bundle/setup/cli.mjs diagnose
  exit
fi
if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo 'Loading the included HOME containers. This may take a few minutes.'
  docker load -i images.tar
fi
if [ "$action" = upgrade ] || [ "$action" = import ]; then
  [ "$#" -eq 2 ] || { echo 'Pass the old HOME or source checkout folder after the action.' >&2; exit 1; }
  previous=$(CDPATH= cd -P -- "$2" && pwd -P)
  current=$(pwd -P)
  case "$previous/" in "$current/"*) echo 'Old and new folders must be separate and non-nested.' >&2; exit 1 ;; esac
  case "$current/" in "$previous/"*) echo 'Old and new folders must be separate and non-nested.' >&2; exit 1 ;; esac
  case "$previous$current" in *,*) echo 'Installation paths must not contain commas.' >&2; exit 1 ;; esac
  if [ "$action" = import ]; then
    resolved=$(cd -- "$previous" && docker compose --project-directory "$previous" -f "$previous/docker-compose.yml" --profile '*' config --no-path-resolution --format json)
    project=$(printf '%s' "$resolved" | docker run --rm -i --mount "type=bind,source=$current,target=/bundle" --mount "type=bind,source=$previous,target=/source,readonly" --entrypoint node "$image" /bundle/setup/cli.mjs prepare-import)
    unset resolved
    if [ "$project" != complete ]; then
      case "$project" in ''|*[!a-z0-9_-]*) echo 'Invalid source project.' >&2; exit 1 ;; esac
      containers=$(docker ps -aq --filter "label=com.docker.compose.project=$project")
      [ -n "$containers" ] || { echo 'Keep the source containers present; use stop rather than down before import.' >&2; exit 1; }
      for container in $containers; do
        config_files=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$container")
        case "$config_files" in *,*|'') echo 'Compose overrides require a dedicated migration.' >&2; exit 1 ;; esac
        config_dir=$(CDPATH= cd -P -- "$(dirname -- "$config_files")" && pwd -P)
        [ "$config_dir" = "$previous" ] && [ "$(basename -- "$config_files")" = docker-compose.yml ] || { echo 'Source containers belong to another checkout.' >&2; exit 1; }
      done
      inspected=$(docker inspect $containers)
      printf '%s' "$inspected" | docker run --rm -i --mount "type=bind,source=$current,target=/bundle" --entrypoint node "$image" /bundle/setup/cli.mjs check-import-containers
      unset inspected
      volumes=$(docker run --rm --mount "type=bind,source=$current,target=/bundle" --entrypoint node "$image" /bundle/setup/cli.mjs import-mounts)
      set -- run --rm --mount "type=bind,source=$current,target=/bundle" --mount "type=bind,source=$previous,target=/source,readonly" --mount "type=bind,source=$previous/backups,target=/import-source/backups,readonly"
      while IFS='=' read -r logical actual; do
        [ -n "$logical" ] || continue
        if metadata=$(docker volume inspect "$actual" 2>/dev/null); then
          printf '%s' "$metadata" | docker run --rm -i --mount "type=bind,source=$current,target=/bundle" --entrypoint node "$image" /bundle/setup/cli.mjs check-import-volume "$logical"
          set -- "$@" --mount "type=volume,source=$actual,target=/import-source/data/$logical,readonly,volume-nocopy"
        else
          case "$logical" in caddy_data|caddy_config) continue ;; *) echo 'A required source volume is missing; import refused.' >&2; exit 1 ;; esac
        fi
      done <<EOF
$volumes
EOF
      echo 'Stopping source HOME and verifying that no other containers write to its volumes.'
      docker compose --project-name "$project" --project-directory "$previous" -f "$previous/docker-compose.yml" --profile '*' stop
      running=$(docker ps -q --filter "label=com.docker.compose.project=$project")
      [ -z "$running" ] || { echo 'Source containers are still running; import refused.' >&2; exit 1; }
      while IFS='=' read -r logical actual; do
        [ -n "$logical" ] || continue
        writers=$(docker ps -q --filter "volume=$actual")
        [ -z "$writers" ] || { echo 'Another container is using source storage; import refused.' >&2; exit 1; }
      done <<EOF
$volumes
EOF
      docker "$@" --entrypoint node "$image" /bundle/setup/cli.mjs import-source --confirm-stopped
    fi
    docker compose -f compose.json up -d --wait --wait-timeout 180 --remove-orphans
    echo 'HOME imported. Sign in locally with your existing account. Keep the original source and volumes offline for recovery.'
    exit
  fi
  project=$(docker run --rm --mount "type=bind,source=$current,target=/bundle" --mount "type=bind,source=$previous,target=/previous,readonly" --entrypoint node "$image" /bundle/setup/cli.mjs check-upgrade)
  if [ "$project" != complete ]; then
    case "$project" in home-server-????????-????-????-????-????????????) ;; *) echo 'Invalid upgrade project.' >&2; exit 1 ;; esac
    containers=$(docker ps -aq --filter "label=com.docker.compose.project=$project")
    for container in $containers; do
      config_files=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$container")
      case "$config_files" in *,*|'') echo 'Compose overrides cannot be migrated automatically.' >&2; exit 1 ;; esac
      config_dir=$(CDPATH= cd -P -- "$(dirname -- "$config_files")" && pwd -P)
      [ "$config_dir" = "$previous" ] && [ "$(basename -- "$config_files")" = compose.json ] || { echo 'This project uses another folder or Compose overrides; migration refused.' >&2; exit 1; }
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
