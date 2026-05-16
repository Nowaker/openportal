#!/usr/bin/env bash
# Dev-first deploy. Builds once, restarts the dev sandbox first, verifies it
# serves the freshly-built bundle, only then restarts prod. The dev portal
# uses TimeoutStopSec=2 (see ~/projekty/dotfiles/dotfiles/systemd/user/
# openportal-dev.service) so the side-channel verification adds ~5s, not
# 30s. Prod keeps its 30s stop timeout for clean SSE drain.
#
# Verifying on dev first catches asset-pipeline regressions BEFORE they
# touch prod. The user's open chat sessions on portal.desktop.ts.nowaker.net
# only get bounced if dev came up green.
#
# Usage: bash scripts/deploy.sh
#
# Env knobs (override for special cases):
#   DEPLOY_DEV_URL    default http://100.105.229.19:5001/
#   DEPLOY_PROD_URL   default http://100.105.229.19:5000/
#   DEPLOY_SKIP_DEV   set to 1 to bypass dev verification (NOT RECOMMENDED).

set -euo pipefail

DEV_URL="${DEPLOY_DEV_URL:-http://100.105.229.19:5001/}"
PROD_URL="${DEPLOY_PROD_URL:-http://100.105.229.19:5000/}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

probe() {
  local label="$1"
  local url="$2"
  local expected_hash="$3"
  local tries=0
  local max_tries=15
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

current_entry="$(grep -oE '/assets/index-[^"]+\.js' apps/web/.output/server/index.mjs | head -1)"
if [ -z "$current_entry" ]; then
  echo "FATAL: could not determine current entry from .output/server/index.mjs" >&2
  exit 1
fi
expected_hash="$(printf '%s' "$current_entry" | grep -oE 'index-[A-Za-z0-9_-]+\.js')"
echo "build entry: $current_entry"

if [ "${DEPLOY_SKIP_DEV:-0}" != "1" ]; then
  echo "===== dev restart ====="
  systemctl --user restart openportal-dev.service
  probe "dev" "$DEV_URL" "$expected_hash"
fi

echo "===== prod restart ====="
systemctl --user restart openportal.service
probe "prod" "$PROD_URL" "$expected_hash"

echo "===== deploy ok ====="
echo "entry: $current_entry"
echo "dev:   $DEV_URL"
echo "prod:  $PROD_URL"
