// SSH-based credential discovery for remote opencode servers.
//
// When a user adds an opencode server that requires Basic auth, we try
// to fetch the creds via SSH before bothering them with a password
// prompt. Strategy: spawn one `ssh` process to the target host, run a
// chained POSIX shell command that tries multiple extraction methods,
// and return the first set of creds we find.
//
// Methods, in order:
//
//   1. `ps -o pid=,command=,e -axww` — macOS / BSD-style ps prints env
//      after the cmdline when -e is passed. Find rows that look like
//      opencode and grep OPENCODE_SERVER_USERNAME / PASSWORD.
//
//   2. `for p in /proc/[0-9]*/cmdline; ...` — Linux. /proc/<pid>/environ
//      is readable for processes the SSH user owns. Same cred grep.
//
//   3. Common config files (~/.config/opencode/auth.json,
//      ~/.local/share/opencode/auth.json) — fallback in case opencode
//      ever moves to a file-based credential model.
//
// SSH options:
//   - BatchMode=yes: refuse to prompt. We're not interactive; if key
//     auth fails the call fails fast.
//   - ConnectTimeout=5: 5s budget for the TCP+TLS+auth handshake.
//   - StrictHostKeyChecking=no: per user direction. The contention is
//     low: home LAN, the user owns both ends, MITM risk on a
//     known-trusted local network is acceptable for this opt-in flow.
//   - UserKnownHostsFile=/dev/null: avoid polluting ~/.ssh/known_hosts
//     with potentially-rotating LAN keys. Pairs with the above.
//   - LogLevel=ERROR: suppresses the "Warning: Permanently added" line
//     that would otherwise drown the parser.
//
// We don't pin a username; ssh client config (~/.ssh/config) decides.
// Falls back to the local $USER if no config matches, which is the
// standard ssh behaviour. The user can override per-host via
// /api/servers/:id/ssh-probe (defined in the API layer) if the default
// identity isn't what they want.

import { spawn } from "child_process";

export type SshProbeStep =
  | "starting"
  | "connecting"
  | "scanning-processes"
  | "reading-config-files"
  | "no-creds"
  | "got-creds"
  | "ssh-rejected"
  | "ssh-timeout"
  | "ssh-error"
  | "validating";

export interface SshProbeOutcome {
  ok: boolean;
  username?: string;
  password?: string;
  step: SshProbeStep;
  message?: string;
  // Number of milliseconds the probe took end-to-end. Useful in logs to
  // tell "ssh handshake was slow" from "remote shell pipeline was slow".
  elapsedMs: number;
}

export interface SshProbeOptions {
  // Override the SSH-level user (`-l <user>`). When undefined, ssh
  // client config decides — the path the user asked for.
  user?: string;
  // Bag of extra `-o key=value` options. Used by the API endpoint when
  // the user provides a password fallback for hosts that don't accept
  // key auth (we add `-o PreferredAuthentications=password`).
  extraOptions?: Record<string, string>;
  // Hard ceiling on the whole probe. Defaults to 6s — slightly more
  // than the 5s ConnectTimeout so a successful connect has time to run
  // the shell pipeline.
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 6_000;

// Single shell pipeline to run remotely. POSIX-portable: works on
// macOS bash/zsh and Linux dash/bash without bashisms. Outputs one of:
//   OPENCODE_CREDS|<username>|<password>
//   NO_CREDS
// Designed so the parent process can split on '|' without escaping
// surprises (random UUID-shaped passwords don't contain pipes).
//
// Strategy:
//   1. Linux: prefer /proc/<pid>/environ since it's universally
//      readable for our own processes and is the canonical source.
//   2. macOS / BSD: use `ps -E -p <pid>` per-pid, harvested by pgrep.
//   3. Common config files (forward-compat): if/when opencode adds a
//      file-based credential dump.
//
// Why pgrep + per-pid `ps -E` instead of one giant ps + regex: the
// cmdline shape varies (npm wrappers, node interpreters, the
// stand-alone binary, opencode-cli for the desktop). One robust
// approach: ask `pgrep` for everything matching "opencode serve",
// then enumerate envs by pid. Skipping pids whose env doesn't contain
// our keys is cheap.
// String.raw so a single backslash in the source ends up as a single
// backslash in the resulting JS string. Without this, every `\0` /
// `\n` / `\1` would need to be doubled `\\0` / `\\n` / `\\1` and the
// remote shell would receive literal `\0` two-char sequences instead
// of NULs and newlines.
const REMOTE_PIPELINE = String.raw`
set -u
emit_creds() {
  _u="$1"
  _p="$2"
  if [ -n "$_u" ] && [ -n "$_p" ]; then
    printf 'OPENCODE_CREDS|%s|%s\n' "$_u" "$_p"
    exit 0
  fi
}

# Method 1: /proc/<pid>/environ (Linux). Cheaper than spawning ps and
# trustworthy: if we can read environ, we have the real source of
# truth.
if [ -d /proc ]; then
  for cmd in /proc/[0-9]*/cmdline; do
    [ -r "$cmd" ] || continue
    line=$(tr '\0' ' ' < "$cmd" 2>/dev/null) || continue
    case "$line" in
      *opencode*\ serve*|*opencode\ serve*) ;;
      *) continue ;;
    esac
    env_file=$(dirname "$cmd")/environ
    [ -r "$env_file" ] || continue
    user=$(tr '\0' '\n' < "$env_file" | sed -n 's/^OPENCODE_SERVER_USERNAME=//p' | head -1)
    pass=$(tr '\0' '\n' < "$env_file" | sed -n 's/^OPENCODE_SERVER_PASSWORD=//p' | head -1)
    emit_creds "$user" "$pass"
  done
fi

# Method 2: pgrep + per-pid ps -E (macOS / BSD). pgrep's output is one
# pid per line when called without -l; we fan out a ps invocation per
# match. Limit to first 5 to bound the cost in case pgrep over-matches.
pids=$(pgrep -f 'opencode.* serve' 2>/dev/null | head -5)
for pid in $pids; do
  [ -n "$pid" ] || continue
  # ps -E prints the cmdline followed by env vars, all space-separated.
  # Fail silently if we can't read the env (process belongs to another
  # user, sandboxing, etc.).
  envline=$(ps -E -p "$pid" -o command= 2>/dev/null) || continue
  [ -n "$envline" ] || continue
  user=$(printf '%s\n' "$envline" | tr ' ' '\n' | sed -n 's/^OPENCODE_SERVER_USERNAME=//p' | head -1)
  pass=$(printf '%s\n' "$envline" | tr ' ' '\n' | sed -n 's/^OPENCODE_SERVER_PASSWORD=//p' | head -1)
  emit_creds "$user" "$pass"
done

# Method 3: known config file paths. Future-proof: opencode is env-only
# today, but if it ever switches we read these.
for f in "$HOME/.config/opencode/auth.json" "$HOME/.local/share/opencode/auth.json"; do
  [ -r "$f" ] || continue
  # Naive but adequate: each field on its own JSON line. Real JSON
  # parsing on the remote would need awk/python, more fragile across
  # box configurations.
  user=$(grep -oE '"server_username"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | sed -E 's/.*"([^"]*)"$/\1/')
  pass=$(grep -oE '"server_password"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | sed -E 's/.*"([^"]*)"$/\1/')
  emit_creds "$user" "$pass"
done

printf 'NO_CREDS\n'
exit 0
`;

// "List all" pipeline. Same discovery surfaces as REMOTE_PIPELINE but
// emits one line per matching opencode instead of first-match-wins.
// Output format (pipe-separated; empty fields = unknown):
//   OPENCODE_INSTANCE|<pid>|<port>|<hostname>|<user>|<password>
// Followed by a single INSPECT_DONE line so the parser can tell the
// difference between "no opencodes found" and "ssh failed before
// running the pipeline".
//
// Port is derived from --port on the cmdline or the LISTEN socket
// (Linux: /proc/<pid>/net/tcp / `ss -ltnp` / `lsof -p`). Hostname is
// what's after --hostname on the cmdline (defaults blank when not
// set). Credentials come from the same env-harvest paths as the
// single-cred pipeline.
const REMOTE_INSPECT_PIPELINE = String.raw`
set -u

emit() {
  printf 'OPENCODE_INSTANCE|%s|%s|%s|%s|%s\n' "$1" "$2" "$3" "$4" "$5"
}

# Extract a single flag value from a space-delimited cmdline. Accepts
# both --flag value and --flag=value forms.
#
# Note on quoting: this script body is a JS String.raw template literal.
# JS still interpolates dollar-brace tokens even in String.raw - only
# backslashes are preserved - which means any shell variable reference
# using brace form gets parsed by JS instead of staying in the script.
# POSIX shell doesn't require braces for simple var refs, so we use
# $var throughout and live without the braces. The lookup semantics are
# unchanged for our use here.
extract_flag() {
  _cmdline=$1
  _flag=$2
  # --flag=value form
  _v=$(printf '%s\n' "$_cmdline" | tr ' ' '\n' | sed -n "s/^$_flag=//p" | head -1)
  if [ -n "$_v" ]; then
    printf '%s' "$_v"
    return
  fi
  # --flag value form
  printf '%s\n' "$_cmdline" | tr ' ' '\n' | awk -v flag="$_flag" '
    found { print; exit }
    $0 == flag { found=1 }
  '
}

extract_env() {
  _envtext=$1
  _key=$2
  printf '%s\n' "$_envtext" | sed -n "s/^$_key=//p" | head -1
}

# Get the listening port for a pid, when the cmdline didn't have
# --port. Tries ss -> lsof. Returns "" on failure.
port_for_pid() {
  _pid="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | awk -v pid="$_pid" '
      $0 ~ ("pid=" pid ",") {
        # Local address field is column 4 on Linux ss. Strip everything
        # before the last colon to get the port.
        n = split($4, parts, ":")
        print parts[n]
        exit
      }
    '
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -P -n -iTCP -sTCP:LISTEN -a -p "$_pid" 2>/dev/null | awk '
      /LISTEN/ {
        n = split($9, parts, ":")
        print parts[n]
        exit
      }
    '
    return
  fi
  printf ''
}

# Linux: /proc-based scan. Catches every PID whose cmdline contains
# opencode + serve and reports it.
if [ -d /proc ]; then
  for cmd in /proc/[0-9]*/cmdline; do
    [ -r "$cmd" ] || continue
    line=$(tr '\0' ' ' < "$cmd" 2>/dev/null) || continue
    case "$line" in
      *opencode*\ serve*|*opencode\ serve*) ;;
      *) continue ;;
    esac
    pid=$(basename "$(dirname "$cmd")")
    port=$(extract_flag "$line" "--port")
    [ -n "$port" ] || port=$(port_for_pid "$pid")
    bind=$(extract_flag "$line" "--hostname")
    env_file="/proc/$pid/environ"
    user=""
    pass=""
    if [ -r "$env_file" ]; then
      env_text=$(tr '\0' '\n' < "$env_file")
      user=$(extract_env "$env_text" "OPENCODE_SERVER_USERNAME")
      pass=$(extract_env "$env_text" "OPENCODE_SERVER_PASSWORD")
    fi
    # Skip rows we couldn't even derive a port for - the inspect
    # output would be useless without one.
    [ -n "$port" ] && emit "$pid" "$port" "$bind" "$user" "$pass"
  done
fi

# macOS / BSD: pgrep + per-pid ps -E.
if command -v pgrep >/dev/null 2>&1 && [ ! -d /proc ]; then
  for pid in $(pgrep -f 'opencode.* serve' 2>/dev/null | head -10); do
    [ -n "$pid" ] || continue
    envline=$(ps -E -p "$pid" -o command= 2>/dev/null) || continue
    [ -n "$envline" ] || continue
    port=$(extract_flag "$envline" "--port")
    [ -n "$port" ] || port=$(port_for_pid "$pid")
    bind=$(extract_flag "$envline" "--hostname")
    user=$(extract_env "$(printf '%s\n' "$envline" | tr ' ' '\n')" "OPENCODE_SERVER_USERNAME")
    pass=$(extract_env "$(printf '%s\n' "$envline" | tr ' ' '\n')" "OPENCODE_SERVER_PASSWORD")
    [ -n "$port" ] && emit "$pid" "$port" "$bind" "$user" "$pass"
  done
fi

printf 'INSPECT_DONE\n'
exit 0
`;

interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runSsh(
  host: string,
  pipeline: string,
  options: SshProbeOptions,
): Promise<SpawnResult> {
  const args = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=5",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "LogLevel=ERROR",
  ];
  for (const [k, v] of Object.entries(options.extraOptions ?? {})) {
    args.push("-o", `${k}=${v}`);
  }
  if (options.user) {
    args.push("-l", options.user);
  }
  // Force POSIX sh on the remote regardless of the user's login shell
  // (often zsh on macOS, which has different word-splitting semantics
  // for unquoted vars). We pipe the script body via stdin to `sh -s`
  // rather than ssh's argv so quote handling is bulletproof.
  args.push(host, "sh", "-s");

  return new Promise((resolveP) => {
    const child = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const settle = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // already exited
      }
      resolveP({ exitCode, stdout, stderr, timedOut });
    };
    child.stdout?.on("data", (c) => {
      stdout += String(c);
    });
    child.stderr?.on("data", (c) => {
      stderr += String(c);
    });
    child.on("error", () => settle(null));
    child.on("close", (code) => settle(code));
    setTimeout(() => {
      timedOut = true;
      settle(null);
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // Send the pipeline over stdin to `sh -s` on the remote.
    child.stdin?.write(pipeline);
    child.stdin?.end();
  });
}

function classifySshFailure(stderr: string): {
  step: SshProbeStep;
  message: string;
} {
  const lc = stderr.toLowerCase();
  if (lc.includes("permission denied")) {
    return {
      step: "ssh-rejected",
      message: "SSH key auth was refused by the remote host.",
    };
  }
  if (lc.includes("connection timed out") || lc.includes("operation timed out")) {
    return {
      step: "ssh-timeout",
      message: "SSH connection timed out (the host may be down or firewalled).",
    };
  }
  if (lc.includes("no route to host")) {
    return {
      step: "ssh-error",
      message: "No route to host.",
    };
  }
  if (lc.includes("could not resolve hostname")) {
    return {
      step: "ssh-error",
      message: "Could not resolve hostname.",
    };
  }
  if (lc.includes("connection refused")) {
    return {
      step: "ssh-error",
      message: "SSH connection refused (sshd may not be running).",
    };
  }
  return {
    step: "ssh-error",
    message: stderr.split("\n").filter(Boolean)[0] ?? "SSH failed.",
  };
}

export async function probeSshForCreds(
  host: string,
  options: SshProbeOptions = {},
): Promise<SshProbeOutcome> {
  const startedAt = Date.now();
  const result = await runSsh(host, REMOTE_PIPELINE, options);
  const elapsedMs = Date.now() - startedAt;
  if (result.timedOut) {
    return {
      ok: false,
      step: "ssh-timeout",
      message: "SSH probe exceeded its time budget.",
      elapsedMs,
    };
  }
  if (result.exitCode !== 0) {
    const cls = classifySshFailure(result.stderr);
    return { ok: false, ...cls, elapsedMs };
  }
  // Look for the magic line. We tolerate other stdout output in case a
  // login banner or motd printed before our pipeline ran.
  const credsLine = result.stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("OPENCODE_CREDS|"));
  if (!credsLine) {
    return {
      ok: false,
      step: "no-creds",
      message:
        "Connected over SSH, but couldn't find OpenCode credentials in env or config files. Is OpenCode running on the remote host?",
      elapsedMs,
    };
  }
  const [, username, ...passwordParts] = credsLine.split("|");
  // Password might (theoretically) contain a `|`; rejoin everything
  // after the second separator. Today they're UUIDs and don't, but
  // defensive split.
  const password = passwordParts.join("|");
  if (!username || !password) {
    return {
      ok: false,
      step: "no-creds",
      message: "Got an empty credential line back over SSH.",
      elapsedMs,
    };
  }
  return {
    ok: true,
    step: "got-creds",
    username,
    password,
    elapsedMs,
  };
}

// Result of a "list all opencode processes on this host" SSH scan.
// One entry per running opencode found. Used by the inspect-host
// flow when the user supplies just a hostname and wants the Portal
// to figure out what's there.
export interface SshInstance {
  pid: number;
  port: number;
  // The --hostname value from the cmdline ("" / undefined means the
  // server was started without that flag, which means it's bound to
  // opencode's default — 127.0.0.1 unless --mdns was set, then
  // 0.0.0.0). Surfaced for diagnostic purposes; the caller still
  // uses the user-supplied host to construct connect URLs.
  boundHost?: string;
  username?: string;
  password?: string;
}

export interface SshInspectOutcome {
  ok: boolean;
  step: SshProbeStep | "no-instances";
  message?: string;
  instances: SshInstance[];
  elapsedMs: number;
}

export async function probeSshForAllInstances(
  host: string,
  options: SshProbeOptions = {},
): Promise<SshInspectOutcome> {
  const startedAt = Date.now();
  const result = await runSsh(host, REMOTE_INSPECT_PIPELINE, options);
  const elapsedMs = Date.now() - startedAt;
  if (result.timedOut) {
    return {
      ok: false,
      step: "ssh-timeout",
      message: "SSH probe exceeded its time budget.",
      instances: [],
      elapsedMs,
    };
  }
  if (result.exitCode !== 0) {
    const cls = classifySshFailure(result.stderr);
    return { ok: false, ...cls, instances: [], elapsedMs };
  }
  const lines = result.stdout.split("\n").map((l) => l.trim());
  const sawDone = lines.includes("INSPECT_DONE");
  if (!sawDone) {
    // Pipeline didn't finish — likely SSH succeeded but the shell
    // bailed out before our script ran (rare; surface as no-instances
    // rather than fabricating success).
    return {
      ok: false,
      step: "no-instances",
      message:
        "Connected over SSH but the inspect script didn't complete. Remote shell may have rejected the pipeline.",
      instances: [],
      elapsedMs,
    };
  }
  const instances: SshInstance[] = [];
  for (const line of lines) {
    if (!line.startsWith("OPENCODE_INSTANCE|")) continue;
    // Split into at most 6 fields so a password containing | (rare
    // but defensive) rejoins correctly.
    const parts = line.split("|");
    if (parts.length < 3) continue;
    const pid = parseInt(parts[1] ?? "", 10);
    const port = parseInt(parts[2] ?? "", 10);
    if (!Number.isFinite(pid) || !Number.isFinite(port)) continue;
    if (port <= 0 || port >= 65536) continue;
    const boundHost = parts[3] || undefined;
    const username = parts[4] || undefined;
    // Anything after the 5th separator belongs to the password (in
    // case a future password format contains literal pipes).
    const password = parts.slice(5).join("|") || undefined;
    instances.push({ pid, port, boundHost, username, password });
  }
  if (instances.length === 0) {
    return {
      ok: true,
      step: "no-instances",
      message:
        "Connected over SSH but no OpenCode processes are running on this host.",
      instances: [],
      elapsedMs,
    };
  }
  return {
    ok: true,
    step: "got-creds",
    instances,
    elapsedMs,
  };
}
