// Detached fork-job registry. opencode's POST /session/:id/fork copies the
// whole conversation message-by-message and holds the HTTP response open
// until the copy finishes. For a large session that can take many minutes -
// longer than Caddy's `response_header_timeout` (5m, from the dotfiles
// (backend_timeouts) snippet), so the browser leg gets a 504 while opencode
// keeps working and the fork still lands. The user sees a modal stuck on
// "Asking opencode to fork..." that 504s and never resolves.
//
// Fix: run the fork as a portal-side job that is fully detached from the
// originating HTTP request. The POST that starts it returns a jobId
// immediately; the browser polls a short status endpoint until the job
// reports done. Every browser->portal request is now short, so Caddy's
// header timeout can never fire regardless of how long opencode takes.
//
// The job outlives the request that created it: closing the browser tab or
// losing the network does NOT abort the fork. The opencode call runs to
// completion and the result is held for RESULT_TTL_MS so a reconnecting
// poll still resolves. On portal restart in-memory jobs are lost; the fork
// still completes opencode-side and shows up in the sidebar (documented
// limitation, same as long-op-runner).

import { fetchOpencode } from "./opencode-client";

export type ForkJobStatus = "running" | "done" | "error";

interface ForkJob {
  id: string;
  port: number;
  sourceSessionId: string;
  status: ForkJobStatus;
  forkId: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface ForkJobSnapshot {
  status: ForkJobStatus;
  forkId: string | null;
  error: string | null;
}

// Keep a finished job around long enough that a poll gap, a brief
// disconnect, or a tab reload still observes the terminal result.
const RESULT_TTL_MS = 10 * 60 * 1000;

const jobs = new Map<string, ForkJob>();

function gc(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.finishedAt !== null && now - job.finishedAt > RESULT_TTL_MS) {
      jobs.delete(id);
    }
  }
}

function randomJobId(): string {
  return `fork_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function runFork(job: ForkJob, messageID?: string): Promise<void> {
  try {
    // fetchOpencode never throws: transport failures come back as a
    // synthetic 502 Response, so a non-ok status is the single failure
    // signal. No AbortSignal is attached - the fork must run to
    // completion however long opencode needs.
    const res = await fetchOpencode(
      job.port,
      `/session/${encodeURIComponent(job.sourceSessionId)}/fork`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messageID ? { messageID } : {}),
      },
    );
    if (!res.ok) {
      throw new Error(`fork failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { id?: unknown };
    if (!body || typeof body.id !== "string" || body.id.length === 0) {
      throw new Error("fork response missing session id");
    }
    job.forkId = body.id;
    job.status = "done";
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
  } finally {
    job.finishedAt = Date.now();
  }
}

export function startForkJob(opts: {
  port: number;
  sourceSessionId: string;
  messageID?: string;
}): { jobId: string } {
  gc();
  const job: ForkJob = {
    id: randomJobId(),
    port: opts.port,
    sourceSessionId: opts.sourceSessionId,
    status: "running",
    forkId: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  // Detached: not awaited, not tied to the H3 request lifecycle.
  void runFork(job, opts.messageID);
  return { jobId: job.id };
}

export function getForkJob(port: number, jobId: string): ForkJobSnapshot | null {
  gc();
  const job = jobs.get(jobId);
  if (!job || job.port !== port) return null;
  return { status: job.status, forkId: job.forkId, error: job.error };
}
