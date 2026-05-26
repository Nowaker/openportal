import { defineHandler, readBody, setResponseStatus } from "nitro/h3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parsePort, parseRouteParam } from "../../../../lib/validation";
import { invalidateSessionsCache } from "../../../../lib/sessions-cache";
import { invalidateMessagesCache } from "../../../../lib/messages-cache";

const execFileAsync = promisify(execFile);

const MOVE_LOCAL_CLI =
  "/home/nowaker/projekty/nowaker/opencode-tools/move-local.ts";

// move-local (opencode-tools master, commit 25af6fb) now auto-classifies
// in-flight candidates via the stuck-detector plugin:
//   stuck (no-runner / stale-stream) -> auto-skip, move proceeds
//   live (opencode_runtime_busy=true) -> refuse with structured error
// Portal toggles --abort when the user explicitly opts in to aborting
// the live runner. --allow-in-flight is intentionally NOT exposed by
// portal (CLI-only debug knob per the opencode-tools maintainer).
interface RequestBody {
  targetPath?: unknown;
  dryRun?: unknown;
  abort?: unknown;
}

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sessionId = parseRouteParam(event, "id");
  const body = (await readBody(event).catch(() => null)) as RequestBody | null;
  const targetPath =
    typeof body?.targetPath === "string" ? body.targetPath.trim() : "";
  const dryRun = body?.dryRun === true;
  const abort = body?.abort === true;

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
  if (abort) args.push("--abort");

  try {
    const { stdout, stderr } = await execFileAsync("bun", args, {
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (!dryRun) {
      invalidateSessionsCache(port);
      invalidateMessagesCache(sessionId);
    }
    return { ok: true, dryRun, stdout, stderr };
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number;
      message?: string;
    };
    const stderr = e.stderr ?? "";
    // move-local's structured live-runner error per opencode-tools 25af6fb:
    //   refusing to move N actively-running session(s): ses_A, ses_B
    //   [(M stuck subagent(s) would have been auto-skipped).]
    //   Re-run with --abort to abort live runners first, ...
    const liveMatch = stderr.match(
      /refusing to move (\d+) actively-running session\(s\):\s*([^.\n]+)/,
    );
    const liveRunner = liveMatch !== null;
    setResponseStatus(event, liveRunner ? 409 : 500);
    return {
      ok: false,
      dryRun,
      liveRunner,
      liveSessionIds: liveRunner
        ? liveMatch![2]
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [],
      error: stderr || e.message || "move-local CLI failed",
      stdout: e.stdout ?? "",
      stderr,
      code: e.code,
    };
  }
});
