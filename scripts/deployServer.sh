#!/usr/bin/env bash
# Server half of the deploy: replace the BaoTa-managed app directory with a release the CI job
# already uploaded, restart the Node project through the panel's own CLI, and roll back if the
# health check fails.
#
# This file is piped over SSH as `RELEASE_ID=… bash -s`; it runs as root on the Ubuntu host.
# The workflow uploads the unpacked artifact to $RELEASES_DIR/$RELEASE_ID before calling it.
#
# BaoTa restarts a Node project with:
#   /www/server/panel/pyenv/bin/python3 /www/server/panel/script/nodejs-service.py <name> stop|start
# so no panel API token is involved. The project's `path` column in site.db is the working
# directory the panel `cd`s into, which is why the app lives directly in $APP_DIR.
set -uo pipefail

APP_DIR=${APP_DIR:-/www/wwwroot/picpony-front}
RELEASES_DIR=${RELEASES_DIR:-/www/wwwroot/picpony-front-releases}
PROJECT=${PROJECT:-picpony-front}
PORT=${PORT:-3100}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:$PORT/sw.js}
LOG_FILE=${LOG_FILE:-/www/wwwlogs/nodejs/$PROJECT.log}
KEEP_RELEASES=${KEEP_RELEASES:-3}
RELEASE_ID=${RELEASE_ID:?RELEASE_ID is required}
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
CLI=(/www/server/panel/pyenv/bin/python3 /www/server/panel/script/nodejs-service.py)

log() { printf '[deploy] %s\n' "$*"; }
fail() { log "ERROR: $*"; exit 1; }

[ -d "$RELEASE_DIR" ] || fail "release directory $RELEASE_DIR is missing"
[ -f "$RELEASE_DIR/server.js" ] || fail "$RELEASE_ID has no server.js"
[ -d "$RELEASE_DIR/.next/static" ] || fail "$RELEASE_ID has no .next/static"
[ -d "$RELEASE_DIR/node_modules" ] || fail "$RELEASE_ID has no node_modules"

free_kb=$(df -Pk "$RELEASES_DIR" | awk 'NR==2 {print $4}')
[ "${free_kb:-0}" -ge 524288 ] || fail 'less than 512MB free on the releases filesystem'

prev=$(readlink -f "$RELEASES_DIR/current" 2>/dev/null || true)
log "release=$RELEASE_ID previous=${prev:-none} app=$APP_DIR"

wait_for_port_free() {
  for _ in $(seq 1 10); do
    if ! ss -ltn 2>/dev/null | grep -q ":$PORT "; then return 0; fi
    sleep 1
  done
  return 1
}

stop_app() {
  "${CLI[@]}" "$PROJECT" stop >/dev/null 2>&1 || true
  wait_for_port_free && return 0
  log "panel stop did not free :$PORT; killing the listener"
  pids=$(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
  sleep 2
  wait_for_port_free
}

start_app() {
  "${CLI[@]}" "$PROJECT" start >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

# `.next/cache` holds the image optimiser's output and is deliberately not part of a release; keep
# whatever the previous run filled it with. `.env*` is deployment configuration, not build output.
sync_release() {
  rsync -a --delete \
    --exclude '.next/cache' \
    --exclude '.env' \
    --exclude '.env.*' \
    "$1/" "$APP_DIR/"
}

log 'stopping the project'
stop_app || fail "port $PORT is still in use"

log "syncing $RELEASE_ID into $APP_DIR"
if ! sync_release "$RELEASE_DIR"; then
  if [ -n "$prev" ] && [ -d "$prev" ]; then
    log "rsync failed; restoring $(basename "$prev")"
    sync_release "$prev" || true
  fi
  start_app || true
  fail 'rsync failed'
fi

log 'starting the project'
if start_app; then
  ln -sfn "$RELEASE_DIR" "$RELEASES_DIR/current"
  log "healthy at $HEALTH_URL"
else
  log 'health check failed; last log lines:'
  tail -n 30 "$LOG_FILE" 2>/dev/null || true
  if [ -n "$prev" ] && [ -d "$prev" ]; then
    log "rolling back to $(basename "$prev")"
    sync_release "$prev" && { start_app || log 'rollback start failed'; }
  fi
  fail 'deploy failed'
fi

current=$(readlink -f "$RELEASES_DIR/current" 2>/dev/null || true)
log 'pruning old releases'
kept=0
while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  dir=${dir%/}
  [ "$dir" = "$current" ] && continue
  [ "$dir" = "$prev" ] && continue
  kept=$((kept + 1))
  [ "$kept" -le "$KEEP_RELEASES" ] && continue
  log "removing $dir"
  rm -rf "$dir"
done < <(ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null)

log 'done'
