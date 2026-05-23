import { defineHandler, readBody, setResponseStatus } from "nitro/h3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseRouteParam } from "../../../../lib/validation";

const execFileAsync = promisify(execFile);

const MOVE_LOCAL_CLI =
  "/home/nowaker/projekty/nowaker/opencode-tools/move-local.ts";

interface RequestBody {
  targetPath?: unknown;
  dryRun?: unknown;
  allowInFlight?: unknown;
}

export default defineHandler(async (event) => {
  const sessionId = parseRouteParam(event, "id");
  const body = (await readBody(event).catch(() => null)) as RequestBody | null;
  const targetPath =
    typeof body?.targetPath === "string" ? body.targetPath.trim() : "";
  const dryRun = body?.dryRun === true;
  const allowInFlight = body?.allowInFlight === true;

  if (!targetPath) {
    setResponseStatus(event, 400);
    return { ok: false, error: "targetPath required" };
  }
  if (!targetPath.startsWith("/") && !targetPath.startsWith("~/")) {
    setResponseStatus(event, 400);
    return {
      ok: false,
      error: "targetPath must be absolute (start with / or ~/)",
    };
  }

  const args = [
    "run",
    MOVE_LOCAL_CLI,
    "--session",
    sessionId,
    "--target",
    targetPath,
  ];
  if (dryRun) args.push("--dry-run");
  if (allowInFlight) args.push("--allow-in-flight");

  try {
    const { stdout, stderr } = await execFileAsync("bun", args, {
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { ok: true, dryRun, stdout, stderr };
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number;
      message?: string;
    };
    const stderr = e.stderr ?? "";
    const inFlight =
      stderr.includes("in-flight") || stderr.includes("--allow-in-flight");
    setResponseStatus(event, inFlight ? 409 : 500);
    return {
      ok: false,
      dryRun,
      inFlight,
      error: stderr || e.message || "move-local CLI failed",
      stdout: e.stdout ?? "",
      stderr,
      code: e.code,
    };
  }
});
