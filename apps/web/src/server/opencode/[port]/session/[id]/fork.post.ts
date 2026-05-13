import { z } from "zod/v4";
import { defineHandler } from "nitro/h3";
import { fetchOpencode } from "../../../../lib/opencode-client";
import {
  parsePort,
  parseRouteParam,
  parseBody,
} from "../../../../lib/validation";

const forkBodySchema = z.object({
  messageID: z.string().min(1).optional(),
});

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sessionID = parseRouteParam(event, "id");
  const { messageID } = await parseBody(event, forkBodySchema);

  const res = await fetchOpencode(
    port,
    `/session/${encodeURIComponent(sessionID)}/fork`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messageID ? { messageID } : {}),
    },
  );
  if (!res.ok) {
    throw new Error(`fork failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
});
