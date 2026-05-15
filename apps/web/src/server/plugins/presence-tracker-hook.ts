import { definePlugin } from "nitro";
import { useNitroHooks } from "nitro/app";
import { detectClient } from "../lib/client-detection";
import { recordBrowserPresence } from "../lib/presence-tracker";

// Run on EVERY HTTP request (API routes, static assets, anything) and
// record a presence sample iff the User-Agent looks like a real
// browser. The presence tracker uses that record to answer "is the
// user physically at this computer right now?" for the sudo
// dispatcher. Non-browser callers (curl, wget, Bun/Node fetch, the
// openportal-sudo-mcp sidecar) are explicitly filtered out by
// recordBrowserPresence so their requests do not flip presence to
// "local" right before the dispatcher reads it.
//
// Wrapped in try/catch because presence detection MUST NEVER break a
// request. A bug here would surface as 500s on every API call,
// including /api/instance/self which the frontend pings every 10s.
export default definePlugin(() => {
  const hooks = useNitroHooks();
  hooks.hook("request", (event) => {
    try {
      const userAgent = event.headers?.get("user-agent") ?? null;
      const client = detectClient(event);
      recordBrowserPresence(client, userAgent);
    } catch {
      // intentional: presence tracking is fire-and-forget
    }
  });
});
