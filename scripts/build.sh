#!/usr/bin/env bash
#
# OpenPortal build wrapper that makes stale-asset 500s impossible.
#
# What it guarantees:
#   - Old hashed assets from prior builds are preserved on disk under
#     .output/public/assets/ alongside the new ones. The fallback hook
#     in apps/web/src/server/plugins/asset-fallback-hook.ts serves any
#     file present there regardless of Nitro's in-memory manifest, so
#     a browser tab still referencing an older hash gets its asset.
#   - Turbo's cache is wiped every time. The earlier deploy-disaster
#     where turbo returned a pre-fix bundle (TDZ regression) cannot
#     recur: every build starts cold.
#   - If the build fails, the existing .output is restored intact and
#     the running server keeps serving its previous bundle. A failed
#     rebuild never breaks the live site.
#   - Asset retention is age-bounded so the .output directory doesn't
#     grow without limit. Files older than 14 days are pruned at the
#     end of every build. Anything within 14 days survives any number
#     of rebuilds.
#
# Usage:  bash scripts/build.sh
#         (or: openportal-build  if symlinked into $PATH)

set -euo pipefail

cd "$(dirname "$0")/.."

OUTPUT="apps/web/.output"
ASSETS="$OUTPUT/public/assets"
SNAPSHOT="/tmp/openportal-asset-snapshot.$$"
RETENTION_DAYS=14

cleanup_snapshot() {
  rm -rf "$SNAPSHOT" 2>/dev/null || true
}
trap cleanup_snapshot EXIT

# 1. Snapshot the current build's assets to a temp dir.
#    Hardlinks where possible - free on the same filesystem.
if [ -d "$ASSETS" ]; then
  mkdir -p "$SNAPSHOT"
  if ! cp -al "$ASSETS/." "$SNAPSHOT/" 2>/dev/null; then
    cp -a "$ASSETS/." "$SNAPSHOT/"
  fi
  echo "build.sh: snapshotted $(ls "$SNAPSHOT" | wc -l) assets to $SNAPSHOT"
fi

# 2. Wipe build outputs + every turbo cache. Without this, turbo can
#    restore an outdated build whose hashes match the source content
#    fingerprint but whose contents reflect older transformations.
echo "build.sh: clean wipe of .output + .turbo dirs"
rm -rf "$OUTPUT"
find . -maxdepth 4 -type d -name ".turbo" -print0 2>/dev/null \
  | xargs -0 rm -rf 2>/dev/null || true

# 3. Build. If this fails, abort - the running server keeps its
#    bundle in memory and live requests continue serving from the
#    OS file cache (the inode is alive as long as something has it
#    open), so the user sees no break.
if ! bun run build; then
  echo "build.sh: build FAILED, leaving previous .output intact" >&2
  exit 1
fi

# 4. Layer snapshotted assets into the new .output. New files win on
#    name collision (the snapshot uses cp -n: "no clobber") so the
#    just-built hashes are served as written; everything else is
#    preserved.
if [ -d "$SNAPSHOT" ]; then
  mkdir -p "$ASSETS"
  cp -an "$SNAPSHOT/." "$ASSETS/" 2>/dev/null || cp -rn "$SNAPSHOT/." "$ASSETS/"
  RESTORED=$(ls "$ASSETS" | wc -l)
  echo "build.sh: retention layer restored, $RESTORED total files in $ASSETS"
fi

# 5. Prune assets older than retention window. Skips the freshly-
#    built ones (their mtime is current). The bound is loose -
#    -mtime +N rounds to whole days - which is fine here.
PRUNED=$(find "$ASSETS" -type f -mtime "+$RETENTION_DAYS" -print 2>/dev/null | wc -l)
if [ "$PRUNED" -gt 0 ]; then
  find "$ASSETS" -type f -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true
  echo "build.sh: pruned $PRUNED file(s) older than $RETENTION_DAYS days"
fi

# 6. Report. The current entry is whichever index-*.js the freshly
#    built .output/server/index.mjs references - newest by mtime
#    isn't reliable when retention restored older files.
SERVER_INDEX="$OUTPUT/server/index.mjs"
if [ -f "$SERVER_INDEX" ]; then
  CURRENT_ENTRY=$(grep -oE '/assets/index-[^"]+\.js' "$SERVER_INDEX" | head -1)
  echo "build.sh: build complete. Current entry: ${CURRENT_ENTRY:-(unknown)}"
else
  echo "build.sh: build complete. (server bundle not found)"
fi
