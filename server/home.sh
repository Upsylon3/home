#!/bin/sh
set -eu
cd -- "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
action=${1:-start}
case "$action" in start|code|access|diagnose|snapshot|recover-snapshot|export-backups|verify-backups|stop|status|logs|upgrade|import) ;; *) echo 'Usage: ./home.sh [start|code|access|diagnose|snapshot DESTINATION|recover-snapshot|export-backups DESTINATION|verify-backups EXPORT-FOLDER|stop|status|logs|upgrade OLD-FOLDER|import SOURCE-FOLDER]' >&2; exit 1 ;; esac
command -v docker >/dev/null 2>&1 || { echo 'Install Docker Engine with Compose (Linux) or Docker Desktop (macOS), then run HOME again. See START-HERE.md.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Start Docker, select Linux containers if applicable, and try again.' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo 'Docker Compose v2 is required. See START-HERE.md.' >&2; exit 1; }
if [ -e configuration/snapshot-state.json ] || [ -L configuration/snapshot-state.json ]; then
  case "$action" in status|logs|recover-snapshot) ;; *) echo 'Snapshot recovery is pending. Run ./home.sh recover-snapshot before other actions.' >&2; exit 1 ;; esac
fi

# Deliberately exclude container environment/config values from inspection.
snapshot_inventory() {
  ids=$(docker ps -aq --no-trunc) || return 1
  if [ -z "$ids" ]; then printf '[]'; return; fi
  for id in $ids; do
    case "$id" in *[!a-f0-9]*) return 1 ;; esac
    [ "${#id}" -eq 64 ] || return 1
  done
  docker inspect --format '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"paused":{{json .State.Paused}},"restarting":{{json .State.Restarting}},"health":{{with index .State "Health"}}{{json .Status}}{{else}}null{{end}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"config":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},"job":{{json (index .Config.Labels "home.snapshot.job")}},"mounts":{{json .Mounts}}}' $ids
}
snapshot_helper() {
  printf '%s' "${2:-}" | docker run --rm -i --user "$(id -u):$(id -g)" --network none --cap-drop ALL --security-opt no-new-privileges \
    --mount "type=bind,source=$snapshot_root,target=/bundle" --entrypoint node "$snapshot_image" /bundle/setup/cli.mjs "$1" "$snapshot_root"
}
resume_snapshot() {
  inventory=$(snapshot_inventory) || return 1
  restore_ids=$(snapshot_helper snapshot-resume "$inventory") || return 1
  if [ -n "$restore_ids" ]; then docker start $restore_ids >/dev/null || return 1; fi
  attempt=0
  while [ "$attempt" -lt 90 ]; do
    inventory=$(snapshot_inventory) || return 1
    if snapshot_helper snapshot-finish "$inventory"; then
      echo 'Previous running state restored. Services that were stopped stayed stopped.'
      return 0
    else
      snapshot_wait_status=$?
      [ "$snapshot_wait_status" -eq 2 ] || return "$snapshot_wait_status"
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  echo 'Services did not become ready. Run recover-snapshot after checking status and logs.' >&2
  return 1
}
if [ "$action" = recover-snapshot ]; then
  [ "$#" -eq 1 ] || { echo 'Usage: ./home.sh recover-snapshot' >&2; exit 1; }
  snapshot_root=$(pwd -P)
  snapshot_image=$(cat installer-image.txt)
  resume_snapshot
  exit
fi
case "$action" in
  stop) docker compose -f compose.json stop; exit ;;
  status) docker compose -f compose.json ps; exit ;;
  logs) docker compose -f compose.json logs --tail 100; exit ;;
esac
if [ "$action" = export-backups ] || [ "$action" = verify-backups ] || [ "$action" = snapshot ]; then
  [ "$#" -eq 2 ] || { echo 'Pass an existing mounted destination folder, or an export folder to verify.' >&2; exit 1; }
  destination=$(CDPATH= cd -P -- "$2" && pwd -P)
  current=$(pwd -P)
  [ "$destination" != / ] || { echo 'Backup storage must not contain the installation.' >&2; exit 1; }
  case "$destination/" in "$current/"*) echo 'Backup storage must be outside the installation.' >&2; exit 1 ;; esac
  case "$current/" in "$destination/"*) echo 'Backup storage must not contain the installation.' >&2; exit 1 ;; esac
  case "$destination$current" in *,*) echo 'Backup paths must not contain commas.' >&2; exit 1 ;; esac
  backup_image=$(docker compose -f compose.json images -q backup)
  image_hash=${backup_image#sha256:}
  case "$image_hash" in ''|*[!a-f0-9]*) echo 'Start HOME once so its backup image is available.' >&2; exit 1 ;; esac
  [ "${#image_hash}" -ge 12 ] && [ "${#image_hash}" -le 64 ] || { echo 'Invalid backup image identifier.' >&2; exit 1; }
  if [ "$action" = snapshot ]; then
    snapshot_root=$current
    snapshot_image=$(cat installer-image.txt)
    inventory=$(snapshot_inventory)
    snapshot_helper snapshot-begin "$inventory"
    # Install the recovery trap before the first service is stopped. A lost
    # terminal/Docker connection leaves the protected marker for recovery.
    trap 'snapshot_exit_status=$?; trap - EXIT HUP INT TERM; if ! resume_snapshot; then echo "Snapshot recovery needed. Run ./home.sh recover-snapshot." >&2; snapshot_exit_status=1; fi; exit "$snapshot_exit_status"' EXIT
    trap 'exit 130' HUP INT TERM
    inventory=$(snapshot_inventory)
    original=$(snapshot_helper snapshot-originals "$inventory")
    echo 'Stopping this HOME for a coordinated snapshot. Downtime lasts through capture and verification.'
    if [ -n "$original" ]; then docker stop --timeout 30 $original >/dev/null; fi
    inventory=$(snapshot_inventory)
    quiet=$(snapshot_helper snapshot-check "$inventory")
    job=$(snapshot_helper snapshot-job)
    mounts=$(snapshot_helper snapshot-mounts)
    set -- run --rm --network none --cap-drop ALL --cap-add DAC_OVERRIDE --cap-add CHOWN --security-opt no-new-privileges \
      --label "home.snapshot.job=$job" --mount "type=bind,source=$destination,target=/destination"
    while IFS='=' read -r logical name; do
      [ -n "$logical" ] || continue
      set -- "$@" --mount "type=bind,source=$current/data/$logical,target=/sources/$name,readonly"
    done <<EOF
$mounts
EOF
    docker "$@" --entrypoint python3 "$backup_image" /coordinated.py /sources /destination --confirm-offline --quiesced-at "$quiet" --timeout "${BACKUP_TIMEOUT_SECONDS:-3600}"
    exit
  fi
  if [ "$action" = export-backups ]; then
    docker run --rm --network none --cap-drop ALL --cap-add DAC_OVERRIDE --cap-add CHOWN --security-opt no-new-privileges \
      --mount "type=bind,source=$current/backups,target=/backups,readonly" --mount "type=bind,source=$destination,target=/destination" \
      --entrypoint python3 "$backup_image" /export.py /backups /destination
  else
    docker run --rm --network none --cap-drop ALL --cap-add DAC_OVERRIDE --security-opt no-new-privileges \
      --mount "type=bind,source=$destination,target=/export,readonly" --entrypoint python3 "$backup_image" /export.py --verify /export
  fi
  exit
fi
image=$(cat installer-image.txt)
if [ "$action" = diagnose ]; then
  core=$(docker compose -f compose.json ps -q homecore)
  [ -n "$core" ] || { echo 'Start HOME before running diagnostics.' >&2; exit 1; }
  network=$(docker inspect --format '{{range $name, $value := .NetworkSettings.Networks}}{{$name}}{{end}}' "$core")
  [ -n "$network" ] || { echo 'Could not find this HOME network.' >&2; exit 1; }
  docker run --rm --user "$(id -u):$(id -g)" --read-only --cap-drop ALL --security-opt no-new-privileges --network "$network" --mount "type=bind,source=$(pwd),target=/bundle,readonly" --entrypoint node "$image" /bundle/setup/cli.mjs diagnose
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
