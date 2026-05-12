import { HTTPError, defineHandler } from "nitro/h3";
import {
  getOpencodeBaseUrl,
} from "../../../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../../../lib/validation";
import { invalidateMessagesCache } from "../../../../../../lib/messages-cache";

// Permanently delete a single message and its parts from a session.
// opencode exposes this at DELETE /session/{id}/message/{messageID}.
//
// We bypass the v1 SDK here because it only ships a GET wrapper for that
// path; the underlying server handler accepts DELETE just fine. v2 SDK
// has `deleteMessage` but the rest of Portal's server routes are wired
// through the v1 client, so a raw fetch is the lowest-friction choice.
//
// Cache invalidation is REQUIRED here, not optional. The /messages route
// caches stripped+rewritten messages for 2s to absorb polling load.
// Without an explicit invalidate after a successful DELETE, the revert
// flow has a window where: opencode deleted the rows -> Portal cache
// still serves the old list -> user refreshes within 2s -> sees the
// reverted messages reappear -> blames Portal for "not reverting".
// This was the reported revert no-op. Don't remove this call without
// re-validating that revert survives F5.
//
// Returns the literal `true` body that opencode emits on success.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const id = parseRouteParam(event, "id");
  const messageID = parseRouteParam(event, "messageID");

  const url = `${getOpencodeBaseUrl(port)}/session/${encodeURIComponent(
    id,
  )}/message/${encodeURIComponent(messageID)}`;

  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new HTTPError(
      `Delete message failed: ${response.status} ${body}`.trim(),
      { status: response.status },
    );
  }
  invalidateMessagesCache(id);
  return await response.json();
});
