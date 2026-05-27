import { defineHandler, readBody, setResponseStatus } from "nitro/h3";
import { startRun } from "../lib/long-op-runner";

interface RequestBody {
  sessionId?: unknown;
  port?: unknown;
  directory?: unknown;
  aggressive?: unknown;
}

export default defineHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as RequestBody | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const port = typeof body?.port === "number" ? body.port : 0;
  const directory =
    typeof body?.directory === "string" && body.directory.length > 0
      ? body.directory
      : undefined;
  const aggressive = body?.aggressive === true;
  if (!sessionId) {
    setResponseStatus(event, 400);
    return { ok: false, error: "sessionId required" };
  }
  if (!port) {
    setResponseStatus(event, 400);
    return { ok: false, error: "port required" };
  }
  try {
    const { runId } = await startRun({
      kind: "clean",
      sessionId,
      opencodeUrl: `http://127.0.0.1:${port}`,
      directory,
      aggressive,
    });
    return { ok: true, runId };
  } catch (err) {
    setResponseStatus(event, 500);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "failed to start clean-session",
    };
  }
});
