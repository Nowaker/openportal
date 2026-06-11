import {
  defineHandler,
  readBody,
  setResponseStatus,
} from "nitro/h3";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { resolveScopedPath } from "../lib/fs-security";

interface MkdirBody {
  path?: unknown;
  parent?: unknown;
  name?: unknown;
  gitInit?: unknown;
}

function runGitInit(cwd: string): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn("git", ["init"], {
      cwd,
      stdio: "ignore",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    child.on("error", (err) => rejectP(err));
    child.on("exit", (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`git init exited with code ${code}`));
    });
  });
}

function pathFromBody(body: MkdirBody | null): string | { error: string } {
  const rawPath = typeof body?.path === "string" ? body.path : "";
  if (rawPath.length > 0) return rawPath;

  const parent = typeof body?.parent === "string" ? body.parent : "";
  const rawName = typeof body?.name === "string" ? body.name : "";
  if (!parent && !rawName) return { error: "path required" };
  if (!parent) return { error: "parent required" };

  const name = rawName.trim();
  if (!name) return { error: "name required" };
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    return { error: "name must be a single path segment" };
  }
  return resolve(parent, name);
}

export default defineHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as MkdirBody | null;
  const rawPath = pathFromBody(body);
  if (typeof rawPath !== "string") {
    setResponseStatus(event, 400);
    return { error: rawPath.error };
  }
  if (rawPath.includes("\0")) {
    setResponseStatus(event, 400);
    return { error: "path contains null byte" };
  }
  const scope = resolveScopedPath(rawPath);
  if (!scope.ok || !scope.insideBase) {
    setResponseStatus(event, 403);
    return {
      error:
        scope.error ?? "Path must resolve inside a configured base directory",
    };
  }
  try {
    await mkdir(scope.path, { recursive: false });
    if (body?.gitInit === true) {
      try {
        await runGitInit(scope.path);
      } catch (err) {
        return {
          path: scope.path,
          gitInitFailed: true,
          gitInitError: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return { path: scope.path, gitInitDone: body?.gitInit === true };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "EEXIST") {
      setResponseStatus(event, 409);
      return { error: "Already exists", path: scope.path };
    }
    if (code === "EACCES" || code === "EPERM") {
      setResponseStatus(event, 403);
      return { error: "Permission denied", path: scope.path };
    }
    if (code === "ENOENT") {
      setResponseStatus(event, 404);
      return { error: "Parent directory does not exist", path: scope.path };
    }
    setResponseStatus(event, 500);
    return {
      error: err instanceof Error ? err.message : "mkdir failed",
      path: scope.path,
    };
  }
});
