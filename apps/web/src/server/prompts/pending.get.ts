import { defineHandler, getQuery } from "nitro/h3";

import { listPendingPromptsForSession } from "../lib/prompt-archive";

export default defineHandler((event) => {
  const q = getQuery(event);
  const sessionId = typeof q.session === "string" ? q.session : "";
  if (!sessionId) return { rows: [] };
  const rows = listPendingPromptsForSession(sessionId);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      ts_ms: r.ts_ms,
      session_id: r.session_id,
      raw_text: r.raw_text,
      attachments_count: r.attachments_count,
      attempts: r.attempts,
      last_attempt_at: r.last_attempt_at,
      last_error: r.last_error,
    })),
  };
});
