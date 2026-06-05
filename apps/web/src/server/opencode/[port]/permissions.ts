import { defineHandler } from "nitro/h3";
import { fetchOpencode } from "../../lib/opencode-client";
import { parsePort } from "../../lib/validation";

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const result = await fetchOpencode(port, "/permission");

  if (!result.ok) {
    return new Response(await result.text(), { status: result.status });
  }

  return result.json();
});
