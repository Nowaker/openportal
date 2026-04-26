import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";
import { getOpencodeClient } from "../../../../lib/opencode-client";
import {
  parsePort,
  parseRouteParam,
  parseBody,
} from "../../../../lib/validation";

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
});

type AttachmentPart = {
  type: "file";
  mime: string;
  filename?: string;
  url: string;
};

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
  };

  try {
    await getOpencodeClient(port).session.promptAsync({
      path: { id },
      body: promptBody,
    });
    return { accepted: true };
  } catch (error) {
    throw new HTTPError(
      error instanceof Error ? error.message : "Prompt failed",
      { status: 500 },
    );
  }
});
