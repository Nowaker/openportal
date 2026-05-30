// Long-running subprocess registry for opencode-tools CLIs that the
// portal exposes through the session-hamburger menu (clean-session,
// stuck-compaction-fixer). Each tool emits JSON-Lines progress events
// to a `--progress-file` path; this runner spawns the subprocess,
// tails the file, and fans the events out to SSE subscribers.
//
// Lifecycle:
//   1. startRun(kind, opts) - mints a runId, spawns the subprocess
//      with --progress-file=/tmp/openportal-runs/<runId>.jsonl,
//      starts a poll-based tailer, returns the runId.
//   2. subscribeRun(runId, onEvent) - any already-buffered events are
//      replayed synchronously, then onEvent receives every newline-
//      delimited progress record the subprocess writes until either
//      the subscriber unsubscribes OR the runner finalises the run.
//      Multiple subscribers are supported (re-opens get history).
//   3. On subprocess exit the runner emits a synthetic
//      `process_exited` event (with `code` + final `success` flag),
//      flags `terminated=true`, then keeps the run + buffered events
//      in memory for RUN_TTL_MS so late SSE reconnects still see the
//      tail. After TTL the run + its progress file are removed.
//
// Reliability notes:
//   - Subprocess runs detached from the SSE; closing the browser tab
//     does NOT kill the work. That is intentional - clean / fix
//     operations must complete even if the user disconnects.
//   - File tailer reads from a persistent offset; partial lines are
//     buffered and joined with the next read. Safe against torn writes.
//   - On port restart, all in-memory state is lost. Subprocess
//     children of the previous portal process are reparented to init
//     and continue running, but the runner cannot adopt them - the
//     user will see no progress UI for those, just the eventual
//     forked session appearing in their sidebar. Documented limitation.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, stat, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ProgressEvent {
  ts?: string;
  event: string;
  [key: string]: unknown;
}

export type RunKind = "clean" | "stuck-fix";

export interface StartRunOptions {
  kind: RunKind;
  sessionId: string;
  opencodeUrl: string;
  directory?: string;
  aggressive?: boolean;
  oldSessionDisposition?: "archive" | "keep" | "delete" | "inline";
  keepIntermediateText?: boolean;
  keepStepMarkers?: boolean;
  stripUserSnapshots?: boolean;
  stripSynthetic?: boolean;
  pruneLoop?: boolean;
  pruneTodowrite?: boolean;
  pruneTask?: boolean;
  pruneWebfetch?: boolean;
  dropAfter?: string;
  dropAfterPreserveUser?: boolean;
  cleanBeforeCompaction?: boolean;
}

interface Run {
  id: string;
  kind: RunKind;
  sessionId: string;
  startedAt: number;
  proc: ChildProcess;
  progressPath: string;
  events: ProgressEvent[];
  subscribers: Set<(event: ProgressEvent) => void>;
  terminated: boolean;
  exitCode: number | null;
  forkSessionId: string | null;
  tailerInterval: ReturnType<typeof setInterval> | null;
  cleanupTimeout: ReturnType<typeof setTimeout> | null;
  readOffset: number;
  partialLine: string;
}

const RUN_TTL_MS = 60_000;
const TAIL_POLL_MS = 250;
const PROGRESS_DIR = "/tmp/openportal-runs";
const OPENCODE_TOOLS_DIR = join(
  process.env.OPENCODE_TOOLS_DIR ?? join(homedir(), "projekty/nowaker/opencode-tools"),
);

const runs = new Map<string, Run>();

function randomRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function progressFileFor(runId: string): string {
  return join(PROGRESS_DIR, `${runId}.jsonl`);
}

function scriptPath(kind: RunKind): string {
  return kind === "clean"
    ? join(OPENCODE_TOOLS_DIR, "clean-session.ts")
    : join(OPENCODE_TOOLS_DIR, "stuck-compaction-fixer.ts");
}

function buildArgs(opts: StartRunOptions, progressPath: string): string[] {
  const baseArgs = [
    opts.sessionId,
    "--url",
    opts.opencodeUrl,
    "--progress-file",
    progressPath,
  ];
  if (opts.directory) baseArgs.push("--directory", opts.directory);
  if (opts.kind === "clean") {
    if (opts.aggressive) baseArgs.push("--mode", "aggressive");
    if (opts.oldSessionDisposition)
      baseArgs.push("--old-session-disposition", opts.oldSessionDisposition);
    if (opts.keepIntermediateText) baseArgs.push("--keep-intermediate-text");
    if (opts.keepStepMarkers) baseArgs.push("--keep-step-markers");
    if (opts.stripUserSnapshots) baseArgs.push("--strip-user-snapshots");
    if (opts.stripSynthetic) baseArgs.push("--strip-synthetic");
    if (opts.pruneLoop) baseArgs.push("--prune-loop");
    if (opts.pruneTodowrite) baseArgs.push("--prune-todowrite");
    if (opts.pruneTask) baseArgs.push("--prune-task");
    if (opts.pruneWebfetch) baseArgs.push("--prune-webfetch");
    if (opts.dropAfter) {
      baseArgs.push("--drop-after", opts.dropAfter);
      if (opts.dropAfterPreserveUser) {
        baseArgs.push("--drop-after-preserve=user");
      }
    }
  } else {
    if (opts.cleanBeforeCompaction) baseArgs.push("--clean-before-compaction");
  }
  return baseArgs;
}

async function ensureProgressDir(): Promise<void> {
  await mkdir(PROGRESS_DIR, { recursive: true });
}

async function readNewLines(run: Run): Promise<string[]> {
  let info;
  try {
    info = await stat(run.progressPath);
  } catch {
    return [];
  }
  if (info.size <= run.readOffset) return [];
  const fh = await open(run.progressPath, "r");
  try {
    const length = info.size - run.readOffset;
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, run.readOffset);
    run.readOffset = info.size;
    const chunk = run.partialLine + buf.toString("utf8");
    const lines = chunk.split("\n");
    run.partialLine = lines.pop() ?? "";
    return lines.filter((l) => l.length > 0);
  } finally {
    await fh.close();
  }
}

function emit(run: Run, event: ProgressEvent): void {
  run.events.push(event);
  for (const sub of run.subscribers) {
    try {
      sub(event);
    } catch {
      /* subscriber threw - drop its callback */
      run.subscribers.delete(sub);
    }
  }
  if (event.event === "fork_created" && typeof event.fork_session_id === "string") {
    run.forkSessionId = event.fork_session_id;
  }
  if (event.event === "done" && typeof event.fork_session_id === "string") {
    run.forkSessionId = event.fork_session_id;
  }
}

async function pollProgress(run: Run): Promise<void> {
  const lines = await readNewLines(run);
  for (const line of lines) {
    let parsed: ProgressEvent | null = null;
    try {
      parsed = JSON.parse(line) as ProgressEvent;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed.event !== "string") continue;
    emit(run, parsed);
  }
}

function scheduleFinalCleanup(run: Run): void {
  if (run.cleanupTimeout) return;
  run.cleanupTimeout = setTimeout(() => {
    runs.delete(run.id);
    unlink(run.progressPath).catch(() => {
      /* best-effort */
    });
  }, RUN_TTL_MS);
}

async function finaliseRun(run: Run, exitCode: number | null): Promise<void> {
  await pollProgress(run);
  if (run.tailerInterval) {
    clearInterval(run.tailerInterval);
    run.tailerInterval = null;
  }
  run.terminated = true;
  run.exitCode = exitCode;
  let success = exitCode === 0;
  for (let i = run.events.length - 1; i >= 0; i--) {
    const e = run.events[i]!;
    if (e.event === "done") {
      if (typeof e.success === "boolean") success = e.success && exitCode === 0;
      break;
    }
  }
  emit(run, {
    event: "process_exited",
    ts: new Date().toISOString(),
    code: exitCode,
    success,
    fork_session_id: run.forkSessionId,
  });
  for (const sub of [...run.subscribers]) {
    try {
      sub({
        event: "stream_end",
        ts: new Date().toISOString(),
        success,
        fork_session_id: run.forkSessionId,
      });
    } catch {
      /* drop */
    }
  }
  run.subscribers.clear();
  scheduleFinalCleanup(run);
}

export async function startRun(opts: StartRunOptions): Promise<{ runId: string }> {
  await ensureProgressDir();
  const runId = randomRunId();
  const progressPath = progressFileFor(runId);
  await unlink(progressPath).catch(() => {
    /* may not exist yet */
  });
  const args = buildArgs(opts, progressPath);
  const proc = spawn("bun", [scriptPath(opts.kind), ...args], {
    cwd: OPENCODE_TOOLS_DIR,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, OPENCODE_URL: opts.opencodeUrl },
  });
  const run: Run = {
    id: runId,
    kind: opts.kind,
    sessionId: opts.sessionId,
    startedAt: Date.now(),
    proc,
    progressPath,
    events: [],
    subscribers: new Set(),
    terminated: false,
    exitCode: null,
    forkSessionId: null,
    tailerInterval: null,
    cleanupTimeout: null,
    readOffset: 0,
    partialLine: "",
  };
  runs.set(runId, run);
  emit(run, {
    event: "spawned",
    ts: new Date().toISOString(),
    pid: proc.pid,
    kind: opts.kind,
    session_id: opts.sessionId,
  });
  run.tailerInterval = setInterval(() => {
    void pollProgress(run).catch(() => {
      /* tailer is best-effort; subprocess remains the source of truth */
    });
  }, TAIL_POLL_MS);
  proc.on("exit", (code) => {
    void finaliseRun(run, typeof code === "number" ? code : null);
  });
  proc.on("error", () => {
    void finaliseRun(run, null);
  });
  return { runId };
}

export interface SubscribeResult {
  events: ProgressEvent[];
  terminated: boolean;
  unsubscribe: () => void;
}

export function subscribeRun(
  runId: string,
  onEvent: (event: ProgressEvent) => void,
): SubscribeResult | null {
  const run = runs.get(runId);
  if (!run) return null;
  if (run.terminated) {
    return { events: [...run.events], terminated: true, unsubscribe: () => {} };
  }
  run.subscribers.add(onEvent);
  return {
    events: [...run.events],
    terminated: false,
    unsubscribe: () => {
      run.subscribers.delete(onEvent);
    },
  };
}

export function getRun(runId: string): {
  id: string;
  kind: RunKind;
  sessionId: string;
  terminated: boolean;
  exitCode: number | null;
  forkSessionId: string | null;
  startedAt: number;
  eventCount: number;
} | null {
  const run = runs.get(runId);
  if (!run) return null;
  return {
    id: run.id,
    kind: run.kind,
    sessionId: run.sessionId,
    terminated: run.terminated,
    exitCode: run.exitCode,
    forkSessionId: run.forkSessionId,
    startedAt: run.startedAt,
    eventCount: run.events.length,
  };
}
