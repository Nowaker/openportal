import { defineHandler, getQuery } from "nitro/h3";
import { getOpencodeClientV2 } from "../../lib/opencode-client";
import { parsePort } from "../../lib/validation";

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const client = getOpencodeClientV2(port);
  const query = getQuery(event);
  const directory =
    typeof query.directory === "string" ? query.directory : undefined;
  const result = await client.lsp.status(
    directory ? { directory } : undefined,
  );
  return result.data;
});
