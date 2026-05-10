import { defineHandler } from "nitro/h3";
import { fetchOpencode } from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sessionID = parseRouteParam(event, "id");
  const res = await fetchOpencode(
    port,
    `/session/${sessionID}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ time: { archived: Date.now() } }),
    },
  );
  if (!res.ok) {
    throw new Error(`archive failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
});
