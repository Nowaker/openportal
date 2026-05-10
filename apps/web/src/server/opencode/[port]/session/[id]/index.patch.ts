import { defineHandler, readBody } from "nitro/h3";
import { z } from "zod/v4";
import { fetchOpencode } from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
});

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sessionID = parseRouteParam(event, "id");
  const raw = (await readBody(event)) as unknown;
  const body = updateSchema.parse(raw ?? {});
  const res = await fetchOpencode(
    port,
    `/session/${sessionID}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`session update failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
});
