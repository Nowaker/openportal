// Shared client kernel for forking a session. opencode's fork copies the
// whole conversation and can take minutes; the portal runs it as a detached
// job (see server/lib/fork-jobs.ts) so the browser never holds one long
// request that Caddy would 504 at its 5m response_header_timeout. This helper
// starts the job and polls the short status endpoint until it resolves.
//
// Every session-fork surface (the per-message Fork dialog, the sidebar
// subagent Fork buttons, any future one) MUST go through here so the
// timeout-proof behaviour lives in exactly one place.

export interface ForkResult {
  id: string;
}

interface ForkJobSnapshot {
  status: "running" | "done" | "error";
  forkId: string | null;
  error: string | null;
}

const POLL_INTERVAL_MS = 1500;
const MAX_WAIT_MS = 30 * 60 * 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readError(res: Response): Promise<string> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    /* body already consumed or unreadable */
  }
  if (text) {
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body?.error === "string" && body.error.length > 0) {
        return body.error;
      }
    } catch {
      /* not JSON - fall through to raw text */
    }
    return text;
  }
  return `HTTP ${res.status}`;
}

export async function forkSessionViaJob(opts: {
  port: number;
  sourceSessionId: string;
  messageID?: string | null;
}): Promise<ForkResult> {
  const startRes = await fetch(
    `/api/opencode/${opts.port}/session/${encodeURIComponent(opts.sourceSessionId)}/fork`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts.messageID ? { messageID: opts.messageID } : {}),
    },
  );
  if (!startRes.ok) {
    throw new Error(`HTTP ${startRes.status}: ${await readError(startRes)}`);
  }
  const started = (await startRes.json()) as { jobId?: string };
  if (!started?.jobId) {
    throw new Error("Fork start response missing jobId");
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  while (true) {
    await delay(POLL_INTERVAL_MS);
    const statusRes = await fetch(
      `/api/opencode/${opts.port}/fork-job/${encodeURIComponent(started.jobId)}`,
    );
    if (statusRes.status === 404) {
      throw new Error(
        "Fork is no longer being tracked (the portal may have restarted). " +
          "It may still have been created - check your sidebar.",
      );
    }
    if (!statusRes.ok) {
      // Transient proxy/network blip on a single poll: keep waiting up to
      // the hard deadline instead of failing a fork that's still running.
      if (Date.now() > deadline) {
        throw new Error(`Fork status check failed: HTTP ${statusRes.status}`);
      }
      continue;
    }
    const job = (await statusRes.json()) as ForkJobSnapshot;
    if (job.status === "done" && job.forkId) {
      return { id: job.forkId };
    }
    if (job.status === "error") {
      throw new Error(job.error || "Fork failed");
    }
    if (Date.now() > deadline) {
      throw new Error("Fork timed out after 30 minutes");
    }
  }
}
