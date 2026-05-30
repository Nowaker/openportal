// HARD RULE: never send portal-generated opencode IDs to opencode.
//
// This helper strips any server-assigned ID fields from an outbound
// payload before it hits opencode's HTTP API. It's the last line of
// defence against the lex-compare stuck-loop bug
// (ai-analysis-requests/STUCK_NO_DISPATCH_LEXICOGRAPHIC_ID_BUG.md):
// even if a future code path accidentally injects `messageID`,
// `sessionID`, or `partID` into a payload blob, this strip will
// catch it before opencode sees it.
//
// Primary consumer: pending-prompt-worker (replays legacy
// `payload_json` blobs that may carry a `messageID` from before
// the no-pregen rule landed in AGENTS.md).
//
// See AGENTS.md "Never pre-generate opencode-assigned IDs".

const CALLER_SUPPLIED_ID_FIELDS = [
  "messageID",
  "sessionID",
  "partID",
] as const;

export function stripCallerSuppliedIds<T>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;
  const out: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  for (const field of CALLER_SUPPLIED_ID_FIELDS) {
    delete out[field];
  }
  return out as T;
}

// Exposed for assertions in tests.
export const STRIPPED_ID_FIELDS: readonly string[] = CALLER_SUPPLIED_ID_FIELDS;
