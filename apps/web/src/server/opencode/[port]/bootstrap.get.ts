import { defineHandler } from "nitro/h3";
import { getOpencodeClient } from "../../lib/opencode-client";
import { bootstrapCacheGet } from "../../lib/bootstrap-cache";
import { parsePort } from "../../lib/validation";

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const [providers, agents, config] = await Promise.all([
    bootstrapCacheGet(`${port}:providers`, async () => {
      const client = await getOpencodeClient(port);
      const r = await client.config.providers();
      return r.data;
    }),
    bootstrapCacheGet(`${port}:agents`, async () => {
      const client = await getOpencodeClient(port);
      const r = await client.app.agents();
      return r.data;
    }),
    bootstrapCacheGet(`${port}:config`, async () => {
      const client = await getOpencodeClient(port);
      const r = await client.config.get();
      return r.data;
    }),
  ]);
  return { providers, agents, config };
});
