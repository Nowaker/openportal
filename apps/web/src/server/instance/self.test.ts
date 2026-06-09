import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpRoot: string;
let mockServer: ReturnType<typeof Bun.serve> | null = null;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openportal-self-test-"));
  process.env.OPENPORTAL_DIR = tmpRoot;
});

afterEach(() => {
  mockServer?.stop(true);
  mockServer = null;
  rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.OPENPORTAL_DIR;
});

function writeActiveServerConfig(port: number) {
  writeFileSync(
    join(tmpRoot, "openportal.json"),
    `${JSON.stringify(
      {
        servers: [
          {
            id: "srv-unreachable-test",
            label: "Configured test OpenCode",
            protocol: "http",
            host: "127.0.0.1",
            port,
            webEndpoint: "https://opencode.example.test",
            ephemeral: false,
            addedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        activeServerId: "srv-unreachable-test",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function importFreshSelfHandler() {
  const mod = await import(`./self.ts?cb=${Date.now()}-${Math.random()}`);
  return mod.default as (event: unknown) => Promise<{
    instance: {
      id: string;
      name: string;
      port: number;
      webEndpoint: string;
    } | null;
    error?: string;
    health: { opencode: "up" | "down"; opencodeReason?: string };
  }>;
}

describe("/api/instance/self", () => {
  test("keeps the active instance identity when the active server probe fails", async () => {
    mockServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/config/providers") {
          return new Response("mock opencode failure", { status: 500 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const port = mockServer.port;
    if (port === undefined) throw new Error("mock server did not bind a port");
    writeActiveServerConfig(port);

    const handler = await importFreshSelfHandler();
    const response = await handler({
      headers: new Headers(),
      req: { context: { clientAddress: "127.0.0.1" } },
    });

    expect(response.error).toBe("active-server-unreachable");
    expect(response.health.opencode).toBe("down");
    expect(response.instance).toMatchObject({
      id: "srv-unreachable-test",
      name: "Configured test OpenCode",
      port,
      webEndpoint: "https://opencode.example.test",
    });
  });
});
