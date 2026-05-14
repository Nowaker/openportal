import { spawn } from "node:child_process";
import { z } from "zod/v4";
import { defineHandler, getQuery, HTTPError } from "nitro/h3";
import { parseBody } from "../lib/validation";
import { detectOpencodeService } from "../lib/opencode-service";
import { getServerByPort } from "../lib/server-registry";

const bodySchema = z.object({
  password: z.string().min(1),
  unit: z.string().regex(/^[\w@.+:-]+$/),
});

// systemd unit restart for system-scope services. Accepts the user's
// password in the request body, pipes it to `sudo -S systemctl restart`
// over stdin so it never lands in argv, never echoes to a log, and the
// local variable is dropped the moment the child closes its handle.
// Caller must use HTTPS - we make no effort to scrub if the transport
// itself is plaintext.
async function runSudoRestart(
  password: string,
  unit: string,
  timeoutMs = 30000,
): Promise<{ ok: boolean; exitCode: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "sudo",
      ["-S", "-p", "", "systemctl", "restart", unit],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stderr = "";
    let settled = false;
    const settle = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ ok: exitCode === 0, exitCode, stderr });
    };
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
      } catch {
        // race with natural exit - settle below
      }
      settle(-1);
    }, timeoutMs);
    child.on("close", () => clearTimeout(timer));
    try {
      child.stdin.write(password + "\n");
    } finally {
      child.stdin.end();
    }
  });
}

export default defineHandler(async (event) => {
  const q = getQuery(event);
  const portRaw = typeof q.port === "string" ? q.port : null;
  const port = portRaw && /^\d+$/.test(portRaw) ? Number(portRaw) : null;
  const body = await parseBody(event, bodySchema);

  if (!port) {
    throw new HTTPError("port query param required", { status: 400 });
  }

  const server = getServerByPort(port);
  const host = server?.host ?? "0.0.0.0";
  const svc = detectOpencodeService(host, port);

  if (svc.scope !== "system") {
    throw new HTTPError(
      `Detected scope is ${svc.scope}, not system. Use the user-service restart endpoint instead.`,
      { status: 400 },
    );
  }
  if (svc.unitName !== body.unit) {
    throw new HTTPError(
      `Unit mismatch: detected ${svc.unitName}, request asked for ${body.unit}.`,
      { status: 400 },
    );
  }

  const result = await runSudoRestart(body.password, body.unit);
  return {
    ok: result.ok,
    unit: body.unit,
    note: result.ok
      ? `Restarted ${body.unit} via sudo.`
      : `sudo systemctl restart ${body.unit} failed: ${result.stderr.replace(/.*password.*/gi, "[hidden]")}`,
  };
});
