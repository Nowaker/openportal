import { defineHandler } from "nitro/h3";
import { getOpencodeClient } from "../../lib/opencode-client";
import { bootstrapCacheGet } from "../../lib/bootstrap-cache";
import { parsePort } from "../../lib/validation";

export default defineHandler(async (event) => {
  const port = parsePort(event);
  return bootstrapCacheGet(`${port}:config`, async () => {
    const client = await getOpencodeClient(port);
    const config = await client.config.get();
    return config.data;
  });
});
