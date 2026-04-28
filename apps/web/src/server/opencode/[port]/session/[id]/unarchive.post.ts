import { defineHandler } from "nitro/h3";
import { getOpencodeBaseUrl } from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sessionID = parseRouteParam(event, "id");
  const res = await fetch(
    `${getOpencodeBaseUrl(port)}/session/${sessionID}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ time: { archived: 0 } }),
    },
  );
  if (!res.ok) {
    throw new Error(`unarchive failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
});
