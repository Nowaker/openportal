import { defineHandler, getQuery } from "nitro/h3";
import { readCompanionState } from "./lib/companion-plugin-state";

export default defineHandler((event) => {
  const q = getQuery(event);
  const raw = typeof q.port === "string" ? q.port : Array.isArray(q.port) ? q.port[0] : undefined;
  const port = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  return readCompanionState(port);
});
