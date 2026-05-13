import { HTTPError, defineHandler, readBody } from "nitro/h3";

import { detectClient } from "../lib/client-detection";
import {
  setMappingFor,
  type RequestorMapping,
} from "../lib/vscode-mapping-store";

export default defineHandler(async (event) => {
  const client = detectClient(event);
  if (client.isLocal) {
    throw new HTTPError("local requests don't need a mapping", {
      status: 400,
    });
  }
  const body = (await readBody(event)) as unknown;
  if (
    !body ||
    typeof body !== "object" ||
    !("mapping" in body) ||
    typeof (body as { mapping: unknown }).mapping !== "object"
  ) {
    throw new HTTPError("body.mapping must be an object", { status: 400 });
  }
  const raw = (body as { mapping: Record<string, unknown> }).mapping;
  const cleaned: RequestorMapping = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && v.trim().length > 0) {
      cleaned[k] = v.trim();
    }
  }
  setMappingFor(client.ip, cleaned);
  return { ok: true, requestor: client.ip, mapping: cleaned };
});
