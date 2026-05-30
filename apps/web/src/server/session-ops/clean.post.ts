import { defineHandler, readBody, setResponseStatus } from "nitro/h3";
import { startRun } from "../lib/long-op-runner";

interface RequestBody {
  sessionId?: unknown;
  port?: unknown;
  directory?: unknown;
  aggressive?: unknown;
  oldSessionDisposition?: unknown;
  keepIntermediateText?: unknown;
  keepStepMarkers?: unknown;
  stripUserSnapshots?: unknown;
  stripSynthetic?: unknown;
  pruneLoop?: unknown;
  pruneTodowrite?: unknown;
  pruneTask?: unknown;
  pruneWebfetch?: unknown;
  dropAfter?: unknown;
  dropAfterPreserveUser?: unknown;
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
  const oldSessionDisposition =
    body?.oldSessionDisposition === "archive" ||
    body?.oldSessionDisposition === "keep" ||
    body?.oldSessionDisposition === "delete" ||
    body?.oldSessionDisposition === "inline"
      ? body.oldSessionDisposition
      : "archive";
  const keepIntermediateText = body?.keepIntermediateText === true;
  const keepStepMarkers = body?.keepStepMarkers === true;
  const stripUserSnapshots = body?.stripUserSnapshots === true;
  const stripSynthetic = body?.stripSynthetic === true;
  const pruneLoop = body?.pruneLoop === true;
  const pruneTodowrite = body?.pruneTodowrite === true;
  const pruneTask = body?.pruneTask === true;
  const pruneWebfetch = body?.pruneWebfetch === true;
  const dropAfter =
    typeof body?.dropAfter === "string" && body.dropAfter.trim().length > 0
      ? body.dropAfter.trim()
      : undefined;
  const dropAfterPreserveUser =
    dropAfter != null && body?.dropAfterPreserveUser === true;
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
      oldSessionDisposition,
      keepIntermediateText,
      keepStepMarkers,
      stripUserSnapshots,
      stripSynthetic,
      pruneLoop,
      pruneTodowrite,
      pruneTask,
      pruneWebfetch,
      dropAfter,
      dropAfterPreserveUser,
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
