import { defineHandler, getQuery } from "nitro/h3";

const PLUGIN_HOST = "127.0.0.1";
const PLUGIN_PORT = 4098;
const REQUEST_TIMEOUT_MS = 2500;

async function proxy(path: string): Promise<{
  ok: boolean;
  status: number;
  body: unknown;
}> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(`http://${PLUGIN_HOST}:${PLUGIN_PORT}${path}`, {
      signal: controller.signal,
    });
    clearTimeout(t);
    const body = (await res.json().catch(() => null)) as unknown;
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: { error: err instanceof Error ? err.message : "unreachable" },
    };
  }
}

export default defineHandler(async (event) => {
  const query = getQuery(event);
  const requested = typeof query.scope === "string" ? query.scope : "summary";

  if (requested === "verdicts") {
    return proxy("/verdicts");
  }
  if (requested === "workers") {
    return proxy("/workers");
  }
  if (requested === "config") {
    return proxy("/config");
  }

  const [v, w] = await Promise.all([proxy("/verdicts"), proxy("/workers")]);
  if (!v.ok || !w.ok) {
    return {
      reachable: false,
      error:
        (v.body as { error?: string } | null)?.error ??
        (w.body as { error?: string } | null)?.error ??
        `verdicts:HTTP${v.status} workers:HTTP${w.status}`,
    };
  }
  const verdicts = v.body as Record<
    string,
    {
      sessionID: string;
      verdict: string;
      stuck_cause?: string | null;
      directory?: string;
      idle_seconds?: number;
      threshold_seconds?: number;
    }
  >;
  const stuckSessions: typeof verdicts[string][] = [];
  let healthyCount = 0;
  for (const v of Object.values(verdicts)) {
    if (v.verdict === "stuck") stuckSessions.push(v);
    else if (v.verdict === "healthy") healthyCount += 1;
  }
  const workers = w.body as Array<{
    workerID: string;
    instanceUrl: string;
    lastSeen: number;
  }>;
  return {
    reachable: true,
    workerCount: workers.length,
    workers,
    sessionsTracked: Object.keys(verdicts).length,
    healthyCount,
    stuckCount: stuckSessions.length,
    stuckSessions: stuckSessions.slice(0, 20),
  };
});
