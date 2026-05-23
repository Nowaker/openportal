#!/usr/bin/env bash
set -euo pipefail

# Launch openportal from THIS worktree on an isolated port for testing,
# parallel to prod (5000) and dev (5001) without touching either.
#
# Usage:
#   bash scripts/run-worktree.sh           # default port 5200, build if missing
#   bash scripts/run-worktree.sh 5123      # custom port
#   REBUILD=1 bash scripts/run-worktree.sh # force rebuild bundle
#
# Isolation: each worktree branch gets its own
#   ~/.openportal-worktrees/<branch>/openportal.json
#   ~/.openportal-worktrees/<branch>/openportal-state.json
#   ~/.local/share/openportal-worktrees/<branch>/openportal.db
# Zero risk to prod's ~/.openportal/* or to ~/.openportal-dev/*.
#
# Server registry seed: defaults to opencode-serve-tailscale on 127.0.0.1:4096
# (the user's prod opencode) so the worktree sees real opencode state.
# Edit the seeded openportal.json to change.

PORT="${1:-5200}"
WORKTREE_DIR="$(git rev-parse --show-toplevel)"
BRANCH="$(git -C "$WORKTREE_DIR" rev-parse --abbrev-ref HEAD)"
INSTANCE_TAG="$(printf '%s' "$BRANCH" | tr -c '[:alnum:]_-' '-' | tr -s '-' | sed 's/^-//;s/-$//')"
[[ -z "$INSTANCE_TAG" ]] && INSTANCE_TAG="default"

ISO_DIR="$HOME/.openportal-worktrees/$INSTANCE_TAG"
DB_DIR="$HOME/.local/share/openportal-worktrees/$INSTANCE_TAG"
mkdir -p "$ISO_DIR" "$DB_DIR"

cd "$WORKTREE_DIR"

# Build the web bundle if missing or forced. scripts/build.sh handles
# the asset-retention dance (snapshot, wipe, build, re-layer, prune).
if [[ ! -f "apps/web/.output/server/index.mjs" || "${REBUILD:-0}" == "1" ]]; then
  echo "[worktree-runner] building web bundle..."
  bash scripts/build.sh
fi

# Build the CLI dist same way runner.sh does (turbo cache has caused
# stale-dist regressions). Direct bun build skips turbo.
echo "[worktree-runner] building CLI dist..."
(cd packages/cli && bun build src/index.ts --outdir dist --target bun >/dev/null)

# The bundled CLI computes WEB_SERVER_PATH as packages/cli/web/server/index.mjs
# (sibling to packages/cli/dist via __dirname/../web) and existsSync()-checks
# it at startup. OPENPORTAL_WEB_BUNDLE overrides the actual spawn target, but
# the startup gate still looks at the default symlink path. In prod
# portal-runtime's node_modules has the matching layout; in a worktree we
# wire it directly. Idempotent.
if [[ ! -e packages/cli/web ]]; then
  ln -s "$WORKTREE_DIR/apps/web/.output" packages/cli/web
  echo "[worktree-runner] created symlink packages/cli/web -> apps/web/.output"
fi

# Bind to tailnet IP same as prod/dev. Falls back to 127.0.0.1 if
# tailscale isn't up (rare on this host but keeps the script portable).
TS_IP="$(tailscale ip -4 2>/dev/null | head -n1 || echo '127.0.0.1')"

# Seed the isolated openportal config on first run only. The seed
# points at the user's prod opencode (127.0.0.1:4096) so the worktree
# UI sees real sessions / MCPs / state. Customize if needed.
if [[ ! -f "$ISO_DIR/openportal.json" ]]; then
  cat > "$ISO_DIR/openportal.json" <<EOF
{
  "directories": ["~/projekty"],
  "servers": [
    {
      "id": "srv-local-4096",
      "label": "opencode-serve-tailscale",
      "host": "127.0.0.1",
      "port": 4096,
      "ephemeral": false,
      "addedAt": "$(date -Iseconds)"
    }
  ],
  "activeServerId": "srv-local-4096"
}
EOF
  echo "[worktree-runner] seeded $ISO_DIR/openportal.json (-> 127.0.0.1:4096)"
fi

cat <<EOF
[worktree-runner] launching
  worktree:   $WORKTREE_DIR
  branch:     $BRANCH
  instance:   wt-$INSTANCE_TAG
  port:       $PORT
  hostname:   $TS_IP
  config dir: $ISO_DIR
  db path:    $DB_DIR/openportal.db
  URL:        http://$TS_IP:$PORT/

EOF

# env -i scrubs the environment so the worktree process doesn't
# accidentally inherit prod's OPENPORTAL_* overrides if the user
# sources them in their shell.
exec env -i \
  HOME="$HOME" \
  USER="$USER" \
  PATH="$PATH" \
  TERM="${TERM:-dumb}" \
  LANG="${LANG:-C.UTF-8}" \
  OPENPORTAL_DIR="$ISO_DIR" \
  OPENPORTAL_STATE_PATH="$ISO_DIR/openportal-state.json" \
  OPENPORTAL_DB_PATH="$DB_DIR/openportal.db" \
  OPENPORTAL_WEB_BUNDLE="$WORKTREE_DIR/apps/web/.output/server/index.mjs" \
  bun "$WORKTREE_DIR/packages/cli/dist/index.js" \
    --configless \
    --directory "$HOME/projekty" \
    --port "$PORT" \
    --hostname "$TS_IP" \
    --name "wt-$INSTANCE_TAG"
