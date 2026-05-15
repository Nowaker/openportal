import { spawn } from "node:child_process";
import { z } from "zod/v4";
import { defineHandler } from "nitro/h3";
import { parseBody } from "../lib/validation";
import { isUserLocallyPresent } from "../lib/presence-tracker";
import { registerPendingSudo, type PendingResolution } from "../lib/sudo-pending";

const bodySchema = z.object({
  command: z.string().min(1).max(8192),
  reason: z.string().min(1).max(1024),
});

const COMMAND_TIMEOUT_MS = 30 * 60 * 1000;

interface SudoResult {
  ok: boolean;
  channel: "gui" | "web";
  request_id?: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
}

// sudo -A: ksshaskpass pops a desktop dialog. Password never crosses HTTP,
// never enters openportal memory, never lands in argv.
function runLocalGui(command: string): Promise<SudoResult> {
  return new Promise((resolve) => {
    const child = spawn(
      "sudo",
      ["-A", "-p", "", "--", "bash", "-c", command],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          HOME: process.env.HOME ?? "/home/nowaker",
          USER: process.env.USER ?? "nowaker",
          SUDO_ASKPASS: "/bin/ksshaskpass",
          DISPLAY: process.env.DISPLAY ?? ":0.0",
          XAUTHORITY: process.env.XAUTHORITY ?? "/home/nowaker/.Xauthority",
        },
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (exit_code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ ok: exit_code === 0, channel: "gui", exit_code, stdout, stderr });
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("close", (code) => settle(code));
    child.on("error", (err) => {
      stderr += err.message;
      settle(-1);
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      stderr += "\n[openportal] command timed out";
      settle(-1);
    }, COMMAND_TIMEOUT_MS);
    child.on("close", () => clearTimeout(timer));
  });
}

// sudo -S: read a single line from stdin, never -p prompt, never argv.
// Password reference is wiped from the closure the moment stdin closes.
function runRemoteWithPassword(command: string, password: string): Promise<SudoResult> {
  return new Promise((resolve) => {
    const child = spawn(
      "sudo",
      ["-S", "-p", "", "--", "bash", "-c", command],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          HOME: process.env.HOME ?? "/home/nowaker",
          USER: process.env.USER ?? "nowaker",
        },
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (exit_code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: exit_code === 0,
        channel: "web",
        exit_code,
        stdout,
        stderr: stderr.replace(/.*password.*/gi, "[hidden]"),
      });
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("close", (code) => settle(code));
    child.on("error", (err) => {
      stderr += err.message;
      settle(-1);
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      stderr += "\n[openportal] command timed out";
      settle(-1);
    }, COMMAND_TIMEOUT_MS);
    child.on("close", () => clearTimeout(timer));
    try {
      child.stdin.write(password + "\n");
    } finally {
      child.stdin.end();
      password = "";
    }
  });
}

export default defineHandler(async (event) => {
  const body = await parseBody(event, bodySchema);

  // Use the presence tracker, NOT detectClient on this request.
  // The MCP sidecar calls /api/sudo/run from this host's loopback,
  // so detectClient would always say "local" regardless of where the
  // user actually is. The presence tracker captures the LAST browser
  // request's IP across the whole openportal process; that is the
  // signal of where the user's eyes are, and what determines whether
  // a GUI askpass dialog or a web modal is the right channel.
  if (isUserLocallyPresent()) {
    return runLocalGui(body.command);
  }

  const { request_id, wait } = registerPendingSudo(body.command, body.reason);
  let resolution: PendingResolution;
  try {
    resolution = await wait;
  } catch (err) {
    return {
      ok: false,
      channel: "web" as const,
      request_id,
      exit_code: -1,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
  if (resolution.kind === "deny") {
    return {
      ok: false,
      channel: "web" as const,
      request_id,
      exit_code: -1,
      stdout: "",
      stderr: resolution.reason
        ? `user denied: ${resolution.reason}`
        : "user denied",
    };
  }
  let password = resolution.password;
  try {
    const result = await runRemoteWithPassword(body.command, password);
    return { ...result, request_id };
  } finally {
    password = "";
  }
});
