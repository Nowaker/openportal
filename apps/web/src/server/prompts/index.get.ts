import { defineHandler, getQuery } from "nitro/h3";

import { listPrompts } from "../lib/prompt-archive";

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export default defineHandler((event) => {
  const q = getQuery(event);
  return listPrompts({
    project: asString(q.project),
    session: asString(q.session),
    q: asString(q.q),
    from: asNumber(q.from),
    to: asNumber(q.to),
    limit: asNumber(q.limit),
    cursor: asNumber(q.cursor),
  });
});
