// GET /api/prompts/export
//
// Streams the entire prompt archive as NDJSON (one prompt row per
// line). Lets the user download a complete backup of every prompt
// they have ever submitted across every opencode server openportal
// has been connected to. Filter is the same {project, session, q,
// from, to} shape as /api/prompts so the user can export a slice.
//
// NDJSON instead of a JSON array because the archive can be tens of
// thousands of rows; a single 50-MB JSON array would have to be
// parsed in one shot by any consumer. With NDJSON every line is a
// self-contained row and grep / jq / Python iter-streaming all work
// out of the box.

import { defineHandler, getQuery, setResponseHeader } from "nitro/h3";

import { listPrompts } from "../lib/prompt-archive";

export default defineHandler((event) => {
  const q = getQuery(event);
  const filters = {
    project: typeof q.project === "string" ? q.project : undefined,
    session: typeof q.session === "string" ? q.session : undefined,
    q: typeof q.q === "string" ? q.q : undefined,
    from: typeof q.from === "string" ? Number(q.from) : undefined,
    to: typeof q.to === "string" ? Number(q.to) : undefined,
    limit: 100_000,
  };

  const stamp = new Date()
    .toISOString()
    .replace(/[:T]/g, "-")
    .replace(/\..+/, "");
  setResponseHeader(
    event,
    "Content-Type",
    "application/x-ndjson; charset=utf-8",
  );
  setResponseHeader(
    event,
    "Content-Disposition",
    `attachment; filename="openportal-prompts-${stamp}.ndjson"`,
  );
  setResponseHeader(event, "Cache-Control", "no-store");

  const { rows } = listPrompts(filters);
  const body = rows.map((r) => JSON.stringify(r)).join("\n");
  return body.length > 0 ? body + "\n" : "";
});
