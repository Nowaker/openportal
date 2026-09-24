#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$ROOT/tmp"
FIXTURE=$(mktemp -d "$ROOT/tmp/build-retention.XXXXXX")
trap 'rm -rf "$FIXTURE"' EXIT
mkdir -p "$FIXTURE/scripts" "$FIXTURE/bin"
cp "$ROOT/scripts/build.sh" "$FIXTURE/scripts/"

# Exercise the real wrapper without compiling the application for each case.
cat > "$FIXTURE/bin/bun" <<'BUILD'
#!/usr/bin/env bash
set -eu
assets=apps/web/.output/public/assets
mkdir -p "$assets/nested dir"
printf current > "$assets/shared.js"
printf current > "$assets/nested dir/shared.js"
printf current > "$assets/was-link.js"
ln -s missing-current "$assets/current-link.js"
ln -s missing-current "$assets/current-dir-link"
printf current > "$assets/current-file"
if [ "${UNREADABLE_ASSET:-0}" = 1 ]; then
  chmod 000 tmp/openportal-asset-snapshot.*/unreadable.js
fi
BUILD
cat > "$FIXTURE/bin/cp" <<'COPY'
#!/usr/bin/env bash
if [ "${COPY_FAIL:-0}" = 1 ]; then
  for arg in "$@"; do
    case "$arg" in
      tmp/openportal-asset-snapshot.*/?*)
        echo 'injected retention copy error' >&2
        exit 73
        ;;
    esac
  done
fi
exec /bin/cp "$@"
COPY
chmod +x "$FIXTURE/bin/bun" "$FIXTURE/bin/cp"
export PATH="$FIXTURE/bin:$PATH"
export OPENPORTAL_DEPLOY_LOCK_HELD=1
ASSETS="$FIXTURE/apps/web/.output/public/assets"
mkdir -p "$ASSETS/nested dir" "$ASSETS/current-dir-link" "$ASSETS/current-file"
printf old > "$ASSETS/shared.js"
printf old > "$ASSETS/nested dir/shared.js"
printf retained > "$ASSETS/nested dir/old file.js"
printf retained > "$ASSETS/.hidden.js"
ODD_NAME=$'line\nbreak.js'
printf retained > "$ASSETS/$ODD_NAME"
printf old > "$ASSETS/current-link.js"
ln -s shared.js "$ASSETS/was-link.js"
ln -s shared.js "$ASSETS/old-link.js"
ln -s missing-old "$ASSETS/dangling-link.js"
printf expired > "$ASSETS/expired.js"
touch -t 200001010000 "$ASSETS/expired.js"
bash "$FIXTURE/scripts/build.sh" > "$FIXTURE/success.log" 2>&1
test "$(cat "$ASSETS/shared.js")" = current
test "$(cat "$ASSETS/nested dir/shared.js")" = current
test "$(cat "$ASSETS/was-link.js")" = current
test ! -L "$ASSETS/was-link.js"
test "$(readlink "$ASSETS/current-link.js")" = missing-current
test "$(readlink "$ASSETS/current-dir-link")" = missing-current
test "$(cat "$ASSETS/current-file")" = current
test "$(cat "$ASSETS/nested dir/old file.js")" = retained
test "$(cat "$ASSETS/.hidden.js")" = retained
test "$(cat "$ASSETS/$ODD_NAME")" = retained
test "$(readlink "$ASSETS/old-link.js")" = shared.js
test "$(readlink "$ASSETS/dangling-link.js")" = missing-old
test ! -e "$ASSETS/expired.js"
grep -q 'retention layer restored' "$FIXTURE/success.log"
grep -q 'pruned[[:space:]]*1 file(s)' "$FIXTURE/success.log"
grep -q 'build complete' "$FIXTURE/success.log"
echo 'PASS: collisions, nested/spaced/hidden/newline paths, symlinks, pruning, completion'

status=0
COPY_FAIL=1 bash "$FIXTURE/scripts/build.sh" > "$FIXTURE/failure.log" 2>&1 || status=$?
test "$status" = 73
grep -q 'injected retention copy error' "$FIXTURE/failure.log"
if grep -q 'build complete' "$FIXTURE/failure.log"; then
  echo 'FAIL: copy error reported as a successful build' >&2
  exit 1
fi
test -z "$(find "$FIXTURE/tmp" -name 'openportal-asset-snapshot.*' -print)"
echo 'PASS: real copy failure propagates and snapshot is cleaned'

if [ "$(id -u)" != 0 ]; then
  printf unreadable > "$ASSETS/unreadable.js"
  status=0
  UNREADABLE_ASSET=1 bash "$FIXTURE/scripts/build.sh" > "$FIXTURE/unreadable.log" 2>&1 || status=$?
  test "$status" != 0
  grep -q 'unreadable.js' "$FIXTURE/unreadable.log"
  if grep -q 'build complete' "$FIXTURE/unreadable.log"; then
    echo 'FAIL: unreadable asset reported as a successful build' >&2
    exit 1
  fi
  echo 'PASS: actual unreadable asset fails the build'
else
  echo 'SKIP: unreadable asset check requires a non-root user'
fi
