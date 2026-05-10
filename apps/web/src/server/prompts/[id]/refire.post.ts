import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";

import { getOpencodeClient } from "../../lib/opencode-client";
import { invalidateMessagesCache } from "../../lib/messages-cache";
import { getPromptById } from "../../lib/prompt-archive";
import { parseBody, parseRouteParam } from "../../lib/validation";

const bodySchema = z.object({
  targetPort: z.number().int().positive(),
  targetSessionId: z.string().min(1),
});

export default defineHandler(async (event) => {
  const id = parseRouteParam(event, "id");
  const body = await parseBody(event, bodySchema);
  const row = getPromptById(id);
  if (!row) throw new HTTPError("prompt not found", { status: 404 });

  // Re-fire uses the FILTERED text deliberately: the user picked this
  // row from the archive UI by what they could read, and the unfiltered
  // form would re-inject the ralph/ultrawork wrapping that produced the
  // original loss. Credentials are redacted in both forms, so neither
  // could be used to replay a literal secret.
  const text = row.raw_text;

  const client = await getOpencodeClient(body.targetPort);
  try {
    await client.session.promptAsync({
      path: { id: body.targetSessionId },
      body: {
        parts: [{ type: "text" as const, text }],
        model: row.model_provider && row.model_id
          ? { providerID: row.model_provider, modelID: row.model_id }
          : undefined,
        agent: row.agent ?? undefined,
      },
    });
    invalidateMessagesCache(body.targetSessionId);
    return { accepted: true, targetSessionId: body.targetSessionId };
  } catch (err) {
    throw new HTTPError(
      err instanceof Error ? err.message : "refire failed",
      { status: 500 },
    );
  }
});
