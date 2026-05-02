import { defineHandler, readBody } from "nitro/h3";
import { mkdir, stat } from "fs/promises";
import { resolve, normalize } from "path";
import { spawn } from "child_process";
import { readPortalConfig } from "../lib/portal-config";

// Creates a new project directory inside one of the configured base dirs.
// The {parent} must be at-or-under a base dir; refuses anything else so the
// mkdir endpoint can't be abused to create directories outside Portal's
// declared workspace scope. {name} is sanitized to a single path segment
// (no slashes, no traversal). Returns the full path so the caller can
// trigger the new-session flow on it directly. With gitInit:true also
// runs `git init` in the new directory so the agent has a working git
// repo to operate on from turn one.
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

export default defineHandler(async (event) => {
  const config = readPortalConfig();
  const body = (await readBody(event)) as
    | { parent?: string; name?: string; gitInit?: boolean }
    | undefined;
  const parent = typeof body?.parent === "string" ? body.parent : "";
  const rawName = typeof body?.name === "string" ? body.name : "";
  const gitInit = body?.gitInit === true;

  if (!parent) throw new Error("parent required");
  const name = rawName.trim();
  if (!name) throw new Error("name required");
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error("name must be a single path segment");
  }

  const parentNorm = normalize(parent);
  const inScope = config.baseDirs.some(
    (b) =>
      parentNorm === b.path || parentNorm.startsWith(b.path + "/"),
  );
  if (!inScope) {
    throw new Error("parent is outside any configured workspace");
  }

  const target = resolve(parentNorm, name);
  if (!target.startsWith(parentNorm + "/") && target !== parentNorm) {
    throw new Error("resolved path escapes parent");
  }

  let alreadyExisted = false;
  try {
    const s = await stat(target);
    if (s.isDirectory()) alreadyExisted = true;
    else throw new Error("target exists but is not a directory");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw err;
  }

  if (!alreadyExisted) {
    await mkdir(target, { recursive: true });
  }

  if (gitInit) {
    try {
      await runGitInit(target);
    } catch (err) {
      return {
        path: target,
        gitInitFailed: true,
        gitInitError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { path: target, alreadyExisted, gitInitDone: gitInit };
});
