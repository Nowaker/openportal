import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";
import { fetchOpencode } from "../../../../lib/opencode-client";
import {
  parsePort,
  parseRouteParam,
  parseBody,
} from "../../../../lib/validation";

// 'Revert to message' as a user-facing action is a permanent prune of
// the message list, not opencode's session.revert pointer. opencode's
// pointer is transient: it auto-clears the moment the next prompt lands,
// so any UI that filters by it loses the filter immediately and the user
// sees their reverted messages reappear next to the new prompt - exactly
// the no-op the user reported.
//
// This route physically DELETEs each message in the supplied list via
// `DELETE /session/{id}/message/{messageID}`. The client computes the
// list (target message + everything chronologically after, or just the
// "after" part for assistant-mode reverts), sends them in one POST,
// and we issue the deletes server-side in reverse order.
const revertBodySchema = z.object({
  messageIDs: z.array(z.string().min(1)).min(1),
});

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const id = parseRouteParam(event, "id");
  const { messageIDs } = await parseBody(event, revertBodySchema);

  const ordered = [...messageIDs].reverse();
  const failures: Array<{ messageID: string; status: number }> = [];

  for (const messageID of ordered) {
    const path = `/session/${encodeURIComponent(
      id,
    )}/message/${encodeURIComponent(messageID)}`;
    try {
      const response = await fetchOpencode(port, path, { method: "DELETE" });
      if (!response.ok) {
        failures.push({ messageID, status: response.status });
      }
    } catch {
      failures.push({ messageID, status: 0 });
    }
  }

  if (failures.length > 0) {
    throw new HTTPError(
      `Delete failed for ${failures.length}/${ordered.length} message(s): ${failures
        .map((f) => `${f.messageID}=${f.status}`)
        .join(", ")}`,
      { status: 500 },
    );
  }

  return { deleted: ordered.length };
});
