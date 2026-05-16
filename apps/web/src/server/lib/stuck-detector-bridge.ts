import { getOpencodeClient } from "./opencode-client";
import { getMergedSessionStatus } from "./session-status";

// Detect stuck-from-restart: opencode DB shows an in-flight assistant
// (time.completed=null AND finish=null) but /session/status reports no
// runner for this session. Means the opencode process that owned the
// turn died (OOM, kill, restart) between dispatching the prompt and
// completing it. The DB row will stay in-flight forever because opencode
// has no recovery loop; the next promptAsync would queue behind it and
// the UI would render 'queued' until a human notices.
//
// Returns true when we should pre-emptively abort the dead in-flight
// turn before the prompt dispatcher attempts cleanupStuckSession.
//
// Fails closed: ANY detection error returns false so a probe bug never
// blocks the dispatcher.
export async function detectStuckFromRestart(
  port: number,
  sessionId: string,
): Promise<boolean> {
  try {
    const client = await getOpencodeClient(port);

    let sessionBusy = false;
    try {
      // opencode's /session/status is scoped per-project; the SDK
      // helper (and the bare endpoint) only sees sessions whose
      // directory == opencode-serve CWD, so any session in a real
      // worktree appears missing. Use the merged status helper which
      // walks GET /project + per-directory fan-out.
      const statusMap = await getMergedSessionStatus(port);
      const status = statusMap[sessionId];
      sessionBusy = status?.type === "busy" || status?.type === "retry";
    } catch {
      // status unreachable - treat as not busy and let the message-tail check decide
    }
    if (sessionBusy) return false;

    let messages: Array<{
      info: { role: string; time?: { completed?: number }; finish?: string };
    }> = [];
    try {
      const messagesResp = await client.session.messages({ path: { id: sessionId } });
      messages = (messagesResp.data ?? []) as typeof messages;
    } catch {
      return false;
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.info.role === "assistant") {
        return !m.info.time?.completed && !m.info.finish;
      }
    }
    return false;
  } catch {
    return false;
  }
}
