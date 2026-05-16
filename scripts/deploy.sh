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

set -euo pipefail

DEV_URL="${DEPLOY_DEV_URL:-http://100.105.229.19:5001/}"
PROD_URL="${DEPLOY_PROD_URL:-http://100.105.229.19:5000/}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

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
  echo "===== dev restart (serves apps/web/.output) ====="
  systemctl --user restart openportal-dev.service
  probe "dev" "$DEV_URL" "$expected_hash" 15
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
systemctl --user restart openportal.service
probe "prod" "$PROD_URL" "$expected_hash" 60

echo "===== deploy ok ====="
echo "entry:    $current_entry"
echo "released: $released_entry"
echo "dev:      $DEV_URL"
echo "prod:     $PROD_URL"
