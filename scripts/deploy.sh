#!/usr/bin/env bash
# Release-staging dev-first deploy. Two bundle directories:
#
#   apps/web/.output/           build target (mutable, rebuilt every cycle)
#   apps/web/.output-released/  what prod serves from (atomic-promoted)
#
# Build writes .output. Dev portal serves .output (sees the new bundle
# immediately). Only after dev probe comes up green do we rsync
# .output -> .output-released and restart prod. A broken build leaves
# .output corrupt but .output-released untouched, so prod stays on
# the previous green release. No "I broke prod with a typo" failure
# mode anymore.
#
# The dev portal uses TimeoutStopSec=2 (see ~/projekty/dotfiles/
# dotfiles/systemd/user/openportal-dev.service) so the side-channel
# verification adds ~5s. Prod keeps 30s for clean SSE drain on the
# old bundle, which is why the prod probe budget (60s) is 4x the
# dev probe budget (15s) - the systemd restart can spend 30s
# SIGTERM-draining the previous prod instance before the new one
# even binds the listening socket.
#
# Usage: bash scripts/deploy.sh
#
# Env knobs:
#   DEPLOY_DEV_URL    default http://100.105.229.19:5001/
#   DEPLOY_PROD_URL   default http://100.105.229.19:5000/
#   DEPLOY_SKIP_DEV   set to 1 to bypass dev verification (NOT
#                     RECOMMENDED - drops the release-staging
#                     safety net). The rsync still gates on a
#                     successful build, but a build that "works"
#                     by tsc + builds clean but is functionally
#                     broken would now go straight to prod.
#   DEPLOY_SKIP_SESSION_RENDER_CHECK
#                     set to 1 to bypass the headless browser session
#                     route render check (NOT RECOMMENDED).

set -euo pipefail

DEV_URL="${DEPLOY_DEV_URL:-http://100.105.229.19:5001/}"
PROD_URL="${DEPLOY_PROD_URL:-http://100.105.229.19:5000/}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# A deploy mutates machine-global singletons: the shared
# apps/web/.output build dir (wiped + rebuilt by build.sh),
# apps/web/.output-released, the openportal-dev + openportal systemd
# services, and prod's SQLite DB. Two deploys at once - parallel
# sessions that each merged a commit to main-nowaker and ran this
# script - delete each other's .output mid-build (leaving it with no
# index.html) and each one's dev probe waits for a hash the other just
# overwrote. Serialize on a machine-global flock: the second deploy
# waits for the first to finish, then builds the now-current working
# tree (which already contains the earlier deploy's merged commit) and
# ships it. Last deploy wins; no commit is dropped. flock releases the
# lock when the fd closes - including on crash or kill - so a dead
# deploy never strands the lock. build.sh takes the same lock when run
# directly; the exported flag below tells the build.sh we invoke to
# skip re-locking (it would self-deadlock on the held fd).
DEPLOY_LOCK="${OPENPORTAL_DEPLOY_LOCK:-/tmp/openportal-deploy.lock}"
DEPLOY_LOCK_WAIT="${OPENPORTAL_DEPLOY_LOCK_WAIT:-900}"
exec 9>"$DEPLOY_LOCK"
if ! flock -n 9; then
  echo "deploy.sh: another deploy holds $DEPLOY_LOCK; waiting up to ${DEPLOY_LOCK_WAIT}s..."
  if ! flock -w "$DEPLOY_LOCK_WAIT" 9; then
    echo "deploy.sh: timed out after ${DEPLOY_LOCK_WAIT}s waiting for the deploy lock" >&2
    echo "deploy.sh: if no deploy is actually running, remove $DEPLOY_LOCK or raise OPENPORTAL_DEPLOY_LOCK_WAIT" >&2
    exit 1
  fi
fi
echo "deploy.sh: acquired deploy lock ($DEPLOY_LOCK)"
export OPENPORTAL_DEPLOY_LOCK_HELD=1

OUTPUT_DIR="$repo_root/apps/web/.output"
RELEASED_DIR="$repo_root/apps/web/.output-released"

probe() {
  local label="$1"
  local url="$2"
  local expected_hash="$3"
  local max_tries="${4:-15}"
  local tries=0
  while [ "$tries" -lt "$max_tries" ]; do
    local html
    html="$(curl -sS --max-time 5 "$url" 2>/dev/null || true)"
    local actual
    actual="$(printf '%s' "$html" | grep -oE 'src="/assets/index-[^"]*\.js"' | head -1 || true)"
    if [ -n "$actual" ] && printf '%s' "$actual" | grep -qF "$expected_hash"; then
      echo "$label: $actual ($url)"
      return 0
    fi
    tries=$((tries + 1))
    sleep 1
  done
  echo "$label probe FAILED: expected $expected_hash within ${max_tries}s at $url" >&2
  echo "$label final HTML head:" >&2
  curl -sS --max-time 5 "$url" 2>&1 | head -20 >&2 || true
  return 1
}

seed_render_check_session() {
  local label="$1"
  local db_path="$2"
  echo "===== seed render-check session ($label) ====="
  OPENPORTAL_DB_PATH="$db_path" bun scripts/test-session/seed.mjs
}

check_session_render() {
  local label="$1"
  local url="$2"
  if [ "${DEPLOY_SKIP_SESSION_RENDER_CHECK:-0}" = "1" ]; then
    echo "$label render check: skipped"
    return 0
  fi
  echo "===== $label browser session render check ====="
  OPENPORTAL_RENDER_CHECK_URL="$url" bun scripts/check-session-renders.ts
}

echo "===== build ====="
bash scripts/build.sh

current_entry="$(grep -oE '/assets/index-[^"]+\.js' "$OUTPUT_DIR/server/index.mjs" | head -1)"
if [ -z "$current_entry" ]; then
  echo "FATAL: could not determine current entry from .output/server/index.mjs" >&2
  exit 1
fi
expected_hash="$(printf '%s' "$current_entry" | grep -oE 'index-[A-Za-z0-9_-]+\.js')"
echo "build entry: $current_entry"

if [ "${DEPLOY_SKIP_DEV:-0}" != "1" ]; then
  seed_render_check_session "dev" "$HOME/.local/share/openportal-dev/openportal.db"
  echo "===== dev restart (serves apps/web/.output) ====="
  systemctl --user restart openportal-dev.service
  probe "dev" "$DEV_URL" "$expected_hash" 15
  check_session_render "dev" "$DEV_URL"
fi

echo "===== promote .output -> .output-released ====="
# rsync -a preserves perms/links/times. --delete drops files from
# .output-released that are not in .output (so the released dir mirrors
# the build exactly). Asset retention is layered INSIDE .output by
# scripts/build.sh, so the rsync copies the retained files too -
# .output-released ends up with every retained asset hash plus the
# current ones.
rsync -a --delete "$OUTPUT_DIR/" "$RELEASED_DIR/"
released_entry="$(grep -oE '/assets/index-[^"]+\.js' "$RELEASED_DIR/server/index.mjs" | head -1)"
if [ -z "$released_entry" ] || ! printf '%s' "$released_entry" | grep -qF "$expected_hash"; then
  echo "FATAL: promote left .output-released with mismatched entry: $released_entry" >&2
  exit 1
fi
echo "released entry: $released_entry"

echo "===== prod restart (serves apps/web/.output-released) ====="
seed_render_check_session "prod" "$HOME/.local/share/openportal/openportal.db"
systemctl --user restart openportal.service
probe "prod" "$PROD_URL" "$expected_hash" 60
check_session_render "prod" "$PROD_URL"

echo "===== deploy ok ====="
echo "entry:    $current_entry"
echo "released: $released_entry"
echo "dev:      $DEV_URL"
echo "prod:     $PROD_URL"
