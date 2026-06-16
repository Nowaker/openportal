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

# Reads the SPA entry hash baked into the prebuilt HTML shell. Vite emits
# multiple `/assets/index-<hash>.js` references in server/index.mjs - the
# real page entry plus tiny re-export chunks - so `grep | head -1` lands
# on whichever one Vite ordered first and is wrong as often as right. The
# authoritative entry is the `<script type="module" src=...>` tag inside
# the pre-rendered HTML shell at server/_chunks/renderer-template.mjs;
# that is exactly what dev/prod return to browsers, so anchoring the
# probe to it matches the user-visible bundle exactly. Falls back to the
# old "first hash in index.mjs" pattern only if the renderer template
# doesn't exist (older build layouts), so future Nitro/Vite reshuffles
# can't strand the deploy.
extract_html_entry() {
  local root="$1"
  local renderer="$root/server/_chunks/renderer-template.mjs"
  if [ -f "$renderer" ]; then
    grep -aoE '<script[^>]+src=\\"/assets/index-[A-Za-z0-9_-]+\.js\\"' "$renderer" \
      | grep -aoE '/assets/index-[A-Za-z0-9_-]+\.js' \
      | head -1
    return
  fi
  grep -oE '/assets/index-[^"]+\.js' "$root/server/index.mjs" | head -1
}

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

# Just the index-<hash>.js token of the authoritative HTML entry. Tolerant:
# echoes empty (never errors under set -e) if .output is mid-rebuild and has
# no entry yet.
extract_hash() {
  extract_html_entry "$1" 2>/dev/null | grep -oE 'index-[A-Za-z0-9_-]+\.js' || true
}

# The index-<hash>.js a running server currently returns in its HTML shell.
read_served_hash() {
  curl -sS --max-time 5 "$1" 2>/dev/null \
    | grep -oE 'src="/assets/index-[A-Za-z0-9_-]+\.js"' \
    | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1 || true
}

# Poll a URL until it returns the SAME non-empty entry twice in a row (server
# fully up AND not mid-swap). Echoes the stable hash, or empty on timeout.
wait_served_stable() {
  local url="$1" max="${2:-25}" prev="" cur="" i=0
  while [ "$i" -lt "$max" ]; do
    cur="$(read_served_hash "$url")"
    if [ -n "$cur" ] && [ "$cur" = "$prev" ]; then
      printf '%s' "$cur"
      return 0
    fi
    prev="$cur"
    i=$((i + 1))
    sleep 1
  done
  printf ''
}

# Why a convergence loop instead of "build, then probe dev for the build-time
# hash": apps/web/.output is a machine-global singleton. scripts/build.sh and
# scripts/deploy.sh serialize on $DEPLOY_LOCK, but a raw `bun run build` run
# directly (against AGENTS.md advice, but it happens with many parallel
# sessions) does NOT take the lock and rewrites .output to a fresh hash mid-
# deploy. The old probe demanded dev serve the exact hash captured right after
# our build; an out-of-band rebuild during the ~10s dev restart changed it, so
# the probe failed every time under load and prod could never advance.
#
# Instead: restart dev, read whatever hash it actually stabilizes on, and only
# proceed if .output on disk STILL equals that hash (nothing rewrote it since
# dev booted). Every build comes from the same committed working tree, so any
# fresh consistent build is equally valid to ship. We render-verify that exact
# build, promote it, then re-check the promoted entry to catch a rewrite that
# landed mid-rsync. A render-check failure is a real broken build -> abort
# (never promote). A hash mismatch is just a race -> retry. Bounded by
# DEPLOY_GATE_ATTEMPTS so a relentless build storm fails loudly, not forever.
# Sets PROMOTED_HASH on success.
PROMOTED_HASH=""
gate_and_promote() {
  local attempts="${DEPLOY_GATE_ATTEMPTS:-6}" n=0 served disk rel
  while [ "$n" -lt "$attempts" ]; do
    n=$((n + 1))
    echo "===== dev gate attempt $n/$attempts (restart dev, serves apps/web/.output) ====="
    systemctl --user restart openportal-dev.service
    served="$(wait_served_stable "$DEV_URL" 25)"
    if [ -z "$served" ]; then
      echo "  dev did not stabilize on an entry within 25s; retrying" >&2
      continue
    fi
    disk="$(extract_hash "$OUTPUT_DIR")"
    if [ "$served" != "$disk" ]; then
      echo "  inconsistent: dev serves $served but $OUTPUT_DIR is $disk now" >&2
      echo "  (an out-of-band 'bun run build' rewrote .output during the dev restart) - retrying" >&2
      continue
    fi
    echo "  dev serves $served and .output still matches - render-verifying"
    if ! check_session_render "dev" "$DEV_URL"; then
      echo "FATAL: dev render check failed for $served - the build is broken, not a race." >&2
      echo "       Refusing to promote; .output-released untouched, prod stays on its last release." >&2
      exit 1
    fi
    echo "===== promote .output ($served) -> .output-released ====="
    # rsync -a --delete mirrors .output (including build.sh's retained assets)
    # into the released dir prod serves. The re-check below catches an out-of-
    # band rebuild that lands mid-rsync (released entry would differ).
    rsync -a --delete "$OUTPUT_DIR/" "$RELEASED_DIR/"
    rel="$(extract_hash "$RELEASED_DIR")"
    if [ "$rel" != "$served" ]; then
      echo "  promote torn: .output-released entry $rel != verified $served - retrying" >&2
      continue
    fi
    PROMOTED_HASH="$served"
    echo "  promoted + verified: .output-released entry = $served"
    return 0
  done
  echo "FATAL: could not capture a consistent, render-verified build in $attempts attempts." >&2
  echo "       An out-of-band 'bun run build' (not scripts/build.sh / scripts/deploy.sh, which" >&2
  echo "       both hold the $DEPLOY_LOCK flock) is thrashing $OUTPUT_DIR through the dev gate." >&2
  echo "       Re-run once the build storm subsides, or raise DEPLOY_GATE_ATTEMPTS." >&2
  exit 1
}

# DEPLOY_SKIP_DEV path: promote whatever .output is now, with only a torn-
# rsync guard (no render verification - the safety net the operator opted out
# of). Still loops to dodge a mid-rsync rewrite.
promote_direct() {
  local attempts="${DEPLOY_GATE_ATTEMPTS:-6}" n=0 disk rel
  while [ "$n" -lt "$attempts" ]; do
    n=$((n + 1))
    disk="$(extract_hash "$OUTPUT_DIR")"
    if [ -z "$disk" ]; then
      echo "  $OUTPUT_DIR has no entry yet; retrying" >&2
      sleep 1
      continue
    fi
    rsync -a --delete "$OUTPUT_DIR/" "$RELEASED_DIR/"
    rel="$(extract_hash "$RELEASED_DIR")"
    if [ "$rel" = "$disk" ]; then
      PROMOTED_HASH="$disk"
      echo "  promoted $disk (no dev verification)"
      return 0
    fi
    echo "  promote torn ($rel != $disk); retrying" >&2
  done
  echo "FATAL: could not promote a consistent $OUTPUT_DIR in $attempts attempts." >&2
  exit 1
}

echo "===== build ====="
bash scripts/build.sh

# Dev gate + promote both live in gate_and_promote() (see its header).
if [ "${DEPLOY_SKIP_DEV:-0}" != "1" ]; then
  seed_render_check_session "dev" "$HOME/.local/share/openportal-dev/openportal.db"
  gate_and_promote
else
  echo "===== DEPLOY_SKIP_DEV=1: promote current build WITHOUT dev verification (NOT RECOMMENDED) ====="
  promote_direct
fi
expected_hash="$PROMOTED_HASH"
echo "promoted entry: $expected_hash"

echo "===== prod restart (serves apps/web/.output-released) ====="
seed_render_check_session "prod" "$HOME/.local/share/openportal/openportal.db"
systemctl --user restart openportal.service
probe "prod" "$PROD_URL" "$expected_hash" 60
check_session_render "prod" "$PROD_URL"

echo "===== deploy ok ====="
echo "entry:    $expected_hash"
echo "dev:      $DEV_URL"
echo "prod:     $PROD_URL"
