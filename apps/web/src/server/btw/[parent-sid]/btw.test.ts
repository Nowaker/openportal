// e2e test for the /btw orchestration. No real opencode and no real LLM.
//
// Spins up a tiny Bun.serve() mock that speaks just enough of opencode's
// HTTP surface for runBtwOrchestration to walk its happy + sad paths:
//   POST /session/<id>/fork              -> { id: <new-id> }
//   PATCH /session/<id>                  -> 200 (rename + archive)
//   POST /session/<id>/prompt_async      -> 202
//   GET  /session/<id>/message           -> [<configurable message list>]
//
// The SQLite DB is redirected to a tmp file via OPENPORTAL_DB_PATH so
// each test gets a fresh schema and the production DB is never touched.
// fetchOpencode falls through to localhost for ports it doesn't find in
// the registry, so the mock port just needs to be unused on loopback.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface MockMessage {
  info: {
    id: string;
    role: "user" | "assistant";
    time: { created: number; completed: number | null };
  };
  parts: Array<{ type: string; text?: string }>;
}

interface MockState {
  forkIdSeed: number;
  forkId: string | null;
  patches: Array<{ id: string; body: unknown }>;
  promptReceivedAt: number | null;
  promptText: string | null;
  messagesByForkId: Map<string, MockMessage[]>;
  // After prompt_async, the mock injects a NEW completed assistant
  // (created at promptReceivedAt + 500ms) on the next /message GET.
  pendingAnswerText: string | null;
  pendingAnswerInjected: boolean;
  promptAsyncBehavior: "ok" | "fail";
}

function makeMockState(): MockState {
  return {
    forkIdSeed: 0,
    forkId: null,
    patches: [],
    promptReceivedAt: null,
    promptText: null,
    messagesByForkId: new Map(),
    pendingAnswerText: null,
    pendingAnswerInjected: false,
    promptAsyncBehavior: "ok",
  };
}

interface MockServer {
  port: number;
  state: MockState;
  close: () => Promise<void>;
}

async function startMockOpencode(): Promise<MockServer> {
  const state = makeMockState();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const forkMatch = path.match(/^\/session\/([^/]+)\/fork$/);
      if (forkMatch && req.method === "POST") {
        state.forkIdSeed++;
        const newId = `ses_fork_${state.forkIdSeed}`;
        state.forkId = newId;
        const parentId = decodeURIComponent(forkMatch[1]);
        const inherited = state.messagesByForkId.get(parentId) ?? [];
        state.messagesByForkId.set(newId, [...inherited]);
        return Response.json({ id: newId });
      }
      const patchMatch = path.match(/^\/session\/([^/]+)$/);
      if (patchMatch && req.method === "PATCH") {
        const body = await req.json().catch(() => ({}));
        state.patches.push({ id: decodeURIComponent(patchMatch[1]), body });
        return Response.json({ ok: true });
      }
      const promptMatch = path.match(/^\/session\/([^/]+)\/prompt_async$/);
      if (promptMatch && req.method === "POST") {
        state.promptReceivedAt = Date.now();
        const body = (await req.json().catch(() => ({}))) as {
          parts?: Array<{ type?: string; text?: string }>;
        };
        const firstText = body.parts?.find((p) => p.type === "text")?.text;
        state.promptText = firstText ?? null;
        if (state.promptAsyncBehavior === "fail") {
          return new Response("simulated upstream failure", { status: 500 });
        }
        return new Response(null, { status: 202 });
      }
      const msgMatch = path.match(/^\/session\/([^/]+)\/message$/);
      if (msgMatch && req.method === "GET") {
        const id = decodeURIComponent(msgMatch[1]);
        const list = state.messagesByForkId.get(id) ?? [];
        if (
          state.promptReceivedAt !== null &&
          state.pendingAnswerText !== null &&
          !state.pendingAnswerInjected
        ) {
          const created = state.promptReceivedAt + 500;
          list.push({
            info: {
              id: `msg_new_${created}`,
              role: "assistant",
              time: { created, completed: created + 100 },
            },
            parts: [{ type: "text", text: state.pendingAnswerText }],
          });
          state.messagesByForkId.set(id, list);
          state.pendingAnswerInjected = true;
        }
        return Response.json(list);
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    port: server.port,
    state,
    close: async () => {
      server.stop(true);
    },
  };
}

let tmpRoot: string;
let dbPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "btw-test-"));
  dbPath = join(tmpRoot, "openportal.db");
  process.env.OPENPORTAL_DB_PATH = dbPath;
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.OPENPORTAL_DB_PATH;
});

async function freshImports() {
  const mod = await import(
    `../../lib/synthetic-messages.ts?cb=${Math.random()}`
  );
  const endpoint = await import(`./index.post.ts?cb=${Math.random()}`);
  const dbMod = await import(`../../lib/prompt-db.ts?cb=${Math.random()}`);
  return { mod, endpoint, dbMod };
}

async function waitFor<T>(
  predicate: () => T | null,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = predicate();
    if (v !== null && v !== undefined && v !== false) return v as T;
    await Bun.sleep(50);
  }
  throw new Error(`waitFor: predicate did not pass within ${timeoutMs}ms`);
}

describe("runBtwOrchestration", () => {
  test("picks the NEW assistant created after promptSentAt, not the inherited one", async () => {
    const mock = await startMockOpencode();
    const parentId = "ses_parent_1";
    mock.state.messagesByForkId.set(parentId, [
      {
        info: {
          id: "msg_inherited",
          role: "assistant",
          time: { created: 1, completed: 2 },
        },
        parts: [
          { type: "text", text: "INHERITED COMPLETED ANSWER FROM PARENT" },
        ],
      },
    ]);
    mock.state.pendingAnswerText = "THE REAL /BTW ANSWER";

    const { mod, endpoint } = await freshImports();
    const pending = mod.insertSynthetic({
      parentSessionId: parentId,
      btwIndex: 1,
      role: "assistant",
      text: "",
      pending: true,
    });

    await endpoint.runBtwOrchestration({
      port: mock.port,
      parentSessionId: parentId,
      btwIndex: 1,
      pendingAnswerId: pending.id,
      question: "what is 2+2",
    });

    const rows = mod.listSynthetic(parentId);
    const filled = rows.find((r: { id: string }) => r.id === pending.id);
    expect(filled).toBeTruthy();
    expect(filled?.text).toBe("THE REAL /BTW ANSWER");
    expect(filled?.text).not.toBe("INHERITED COMPLETED ANSWER FROM PARENT");
    expect(filled?.completed_at).toBeTruthy();
    expect(filled?.fork_session_id).toBe("ses_fork_1");

    const archivedPatch = mock.state.patches.find(
      (p) =>
        p.id === "ses_fork_1" &&
        typeof p.body === "object" &&
        p.body !== null &&
        "time" in (p.body as Record<string, unknown>),
    );
    expect(archivedPatch).toBeTruthy();
    const renamePatch = mock.state.patches.find(
      (p) =>
        p.id === "ses_fork_1" &&
        typeof p.body === "object" &&
        p.body !== null &&
        "title" in (p.body as Record<string, unknown>),
    );
    expect(renamePatch).toBeTruthy();
    const title = (renamePatch?.body as { title: string }).title;
    expect(title.startsWith("[btw#1] ")).toBe(true);
    expect(title).toContain("what is 2+2");

    await mock.close();
  });

  test("fills the pending row with error text when prompt_async fails", async () => {
    const mock = await startMockOpencode();
    mock.state.promptAsyncBehavior = "fail";
    const parentId = "ses_parent_3";

    const { mod, endpoint } = await freshImports();
    const pending = mod.insertSynthetic({
      parentSessionId: parentId,
      btwIndex: 1,
      role: "assistant",
      text: "",
      pending: true,
    });

    await endpoint.runBtwOrchestration({
      port: mock.port,
      parentSessionId: parentId,
      btwIndex: 1,
      pendingAnswerId: pending.id,
      question: "fail-me",
    });

    const rows = mod.listSynthetic(parentId);
    const filled = rows.find((r: { id: string }) => r.id === pending.id);
    expect(filled?.text.startsWith("[/btw error]")).toBe(true);
    expect(filled?.completed_at).toBeTruthy();

    await mock.close();
  });
});

describe("synthetic_messages schema migration 0006", () => {
  test("inserts pending row with completed_at=NULL and fills via updateSyntheticAnswer", async () => {
    const { mod } = await freshImports();
    const row = mod.insertSynthetic({
      parentSessionId: "ses_x",
      btwIndex: 1,
      role: "assistant",
      text: "",
      pending: true,
    });
    expect(row.completed_at).toBeNull();

    mod.updateSyntheticAnswer(row.id, "the answer", "ses_fork_abc");

    const all = mod.listSynthetic("ses_x");
    const updated = all.find((r: { id: string }) => r.id === row.id);
    expect(updated?.text).toBe("the answer");
    expect(updated?.completed_at).toBeTruthy();
    expect(updated?.fork_session_id).toBe("ses_fork_abc");
  });

  test("inserts completed (non-pending) row with completed_at=created_at", async () => {
    const { mod } = await freshImports();
    const row = mod.insertSynthetic({
      parentSessionId: "ses_y",
      btwIndex: 1,
      role: "user",
      text: "question",
    });
    expect(row.completed_at).toBe(row.created_at);
  });
});
