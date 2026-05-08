import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";
import {
  getOpencodeClient,
  getOpencodeBaseUrl,
} from "../../../../lib/opencode-client";
import {
  parsePort,
  parseRouteParam,
  parseBody,
} from "../../../../lib/validation";
import { invalidateMessagesCache } from "../../../../lib/messages-cache";

const attachmentSchema = z.object({
  mime: z.string().min(1),
  filename: z.string().optional(),
  url: z.string().min(1),
});

const promptBodySchema = z.object({
  text: z.string().min(1),
  attachments: z.array(attachmentSchema).optional(),
  model: z
    .object({
      providerID: z.string(),
      modelID: z.string(),
    })
    .optional(),
  agent: z.string().optional(),
  variant: z.string().optional(),
});

type AttachmentPart = {
  type: "file";
  mime: string;
  filename?: string;
  url: string;
};

// Grace window: we only declare an assistant message a "zombie" if it has been
// stagnant longer than this. Long-running tools (slow shell commands, large
// fetches, etc.) routinely sit in `state.status === "running"` for many
// seconds, and the assistant message envelope itself is created before the
// first part lands. 60s is wider than any healthy turn-bootstrap window we've
// seen but tight enough that genuinely abandoned turns get reaped on the next
// prompt POST.
const ZOMBIE_AGE_MS = 60_000;

// "Stuck busy": opencode's /session/status reports type:"busy" but no
// assistant-side activity has progressed for this long while at least one
// user message is queued behind. Threshold has to be much wider than the
// zombie window because legitimate streaming turns take seconds to minutes.
// 5min is wider than any healthy single-turn we've observed in this codebase
// but still triggers the recovery path quickly enough that the user only
// has to wait once after a backend lockup.
const STUCK_BUSY_THRESHOLD_MS = 5 * 60_000;

interface CleanupReport {
  status: "idle" | "busy" | "retry" | "unknown";
  cleanedReason: "idle-zombie" | "stuck-busy" | "none";
  deletedZombies: string[];
  aborted: boolean;
}

type MsgEntry = {
  info: {
    id: string;
    role: string;
    time?: { created?: number; completed?: number };
  };
  parts: Array<{
    type: string;
    state?: { status?: string };
    time?: { start?: number; end?: number };
  }>;
};

// Pre-flight cleanup. opencode's runner persists its in-memory turn state
// across requests but reconstructs it from the message history on cold start.
// Two failure modes block new prompts from dispatching:
//
// (A) ZOMBIE assistant messages. An assistant row with no `time.completed`
//     plus either an empty `parts` array (envelope without a turn) or a
//     tool part still flagged `state.status === "running"`. After API
//     errors / process restarts / DB surgery, the runner can lock onto one
//     of these on cold load and silently swallow new prompts: the user
//     message lands in the DB but no assistant turn is ever spawned for it.
// (B) STUCK BUSY runner. opencode reports type:"busy" but its runner has
//     not produced any assistant-side activity for minutes while user
//     messages pile up behind. Equivalent symptom: user prompts queued, no
//     dispatch.
//
// Heuristic, deliberately conservative so a healthy in-flight turn is
// never disrupted:
//
//   - status === "retry" -> opencode's transient backoff. Bail; we'd race
//     its auto-recovery.
//   - status === "idle" (or unreachable) -> reap zombies; abort if any
//     deleted (idempotent on already-idle sessions; flushes any cached
//     runner reference to the deleted rows).
//   - status === "busy" -> only act if the most recent user message
//     timestamp is greater than every assistant-side timestamp on this
//     session AND that "user is ahead" gap exceeds STUCK_BUSY_THRESHOLD_MS.
//     That captures "user has been waiting >5min for the runner to even
//     start an assistant turn" and excludes both legitimate streaming
//     turns (assistant timestamps are fresh) and same-turn user-side tool
//     replies (still inside the assistant's owned window). Reap zombies
//     AND issue abort to forcibly return the runner to idle so the next
//     promptAsync dispatches instead of queueing onto the dead turn.
//
// Every opencode round-trip in this function is wrapped in try/catch. The
// user's prompt MUST reach `promptAsync` even if every step here fails;
// cleanup is a best-effort defence layered in front of the real dispatch.
async function cleanupStuckSession(
  port: number,
  id: string,
): Promise<CleanupReport> {
  const report: CleanupReport = {
    status: "unknown",
    cleanedReason: "none",
    deletedZombies: [],
    aborted: false,
  };
  const client = getOpencodeClient(port);

  let statusType: string | undefined;
  try {
    const statusResp = await client.session.status();
    statusType = (statusResp.data?.[id] as { type?: string } | undefined)
      ?.type;
  } catch {
  }
  if (
    statusType === "idle" ||
    statusType === "busy" ||
    statusType === "retry"
  ) {
    report.status = statusType;
  }

  if (statusType === "retry") {
    return report;
  }

  let messages: MsgEntry[] = [];
  try {
    const messagesResp = await client.session.messages({ path: { id } });
    messages = (messagesResp.data ?? []) as MsgEntry[];
  } catch {
    return report;
  }

  let proceed = false;
  if (statusType === "idle" || statusType === undefined) {
    proceed = true;
    report.cleanedReason = "idle-zombie";
  } else if (statusType === "busy") {
    let lastUser = 0;
    let lastAssistant = 0;
    for (const m of messages) {
      const tCreated = m.info.time?.created ?? 0;
      const tCompleted = m.info.time?.completed ?? 0;
      if (m.info.role === "user") {
        lastUser = Math.max(lastUser, tCreated, tCompleted);
      } else if (m.info.role === "assistant") {
        let newest = Math.max(tCreated, tCompleted);
        for (const p of m.parts ?? []) {
          newest = Math.max(newest, p.time?.start ?? 0, p.time?.end ?? 0);
        }
        lastAssistant = Math.max(lastAssistant, newest);
      }
    }
    const userIsAheadOfAssistant = lastUser > lastAssistant;
    const stagnantFor = Date.now() - Math.max(lastAssistant, lastUser);
    if (userIsAheadOfAssistant && stagnantFor > STUCK_BUSY_THRESHOLD_MS) {
      proceed = true;
      report.cleanedReason = "stuck-busy";
    }
  }

  if (!proceed) {
    return report;
  }

  const now = Date.now();
  const zombieIds: string[] = [];
  for (const m of messages) {
    if (m.info.role !== "assistant") continue;
    if (m.info.time?.completed) continue;
    const created = m.info.time?.created ?? 0;
    if (created && now - created < ZOMBIE_AGE_MS) continue;

    const parts = m.parts ?? [];
    const noParts = parts.length === 0;
    const hasRunningTool = parts.some(
      (p) => p.type === "tool" && p.state?.status === "running",
    );
    if (noParts || hasRunningTool) {
      zombieIds.push(m.info.id);
    }
  }

  const baseUrl = getOpencodeBaseUrl(port);
  for (const messageID of zombieIds) {
    const url = `${baseUrl}/session/${encodeURIComponent(
      id,
    )}/message/${encodeURIComponent(messageID)}`;
    try {
      const resp = await fetch(url, { method: "DELETE" });
      if (resp.ok) {
        report.deletedZombies.push(messageID);
      }
    } catch {
    }
  }

  // Abort whenever we engaged: idle-with-zombies needs the runner to drop
  // any cached pointer to the deleted rows; stuck-busy needs the runner
  // forcibly returned to idle so the next promptAsync dispatches instead
  // of tail-queueing onto the dead turn. Abort is idempotent on idle.
  const shouldAbort =
    report.deletedZombies.length > 0 || report.cleanedReason === "stuck-busy";
  if (shouldAbort) {
    try {
      await client.session.abort({ path: { id } });
      report.aborted = true;
    } catch {
    }
  }

  return report;
}

// Always use OpenCode's `promptAsync` endpoint. It returns 204 immediately
// after the message is appended to the session, and OpenCode serialises
// prompts at the session level on the server side. That makes a Portal-side
// queue both unnecessary and harmful: a client-side queue means every
// message typed while the assistant is busy lives only in the browser tab
// and can be dropped on a refresh, race, or component unmount before it
// ever reaches the backend.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const id = parseRouteParam(event, "id");
  const body = await parseBody(event, promptBodySchema);

  const fileParts: AttachmentPart[] = (body.attachments ?? []).map((a) => ({
    type: "file",
    mime: a.mime,
    filename: a.filename,
    url: a.url,
  }));

  const promptBody = {
    parts: [...fileParts, { type: "text" as const, text: body.text }],
    model: body.model,
    agent: body.agent,
    variant: body.variant,
  };

  const cleanup = await cleanupStuckSession(port, id);

  try {
    await getOpencodeClient(port).session.promptAsync({
      path: { id },
      body: promptBody,
    });
    invalidateMessagesCache(id);
    return { accepted: true, cleanup };
  } catch (error) {
    throw new HTTPError(
      error instanceof Error ? error.message : "Prompt failed",
      { status: 500 },
    );
  }
});
