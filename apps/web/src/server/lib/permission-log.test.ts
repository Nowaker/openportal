import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closePromptDbForTesting } from "./prompt-db";
import {
  listResolvedForSession,
  permissionEventToYaml,
  recordAsked,
  recordResolved,
} from "./permission-log";

let dir: string;

beforeEach(() => {
  closePromptDbForTesting();
  dir = mkdtempSync(join(tmpdir(), "permlog-"));
  process.env.OPENPORTAL_DB_PATH = join(dir, "test.db");
});

afterEach(() => {
  closePromptDbForTesting();
  rmSync(dir, { recursive: true, force: true });
});

test("asked then resolved upserts one row and preserves asked_at", () => {
  recordAsked({
    serverId: "srv-a",
    sessionId: "ses_1",
    requestId: "perm_1",
    askedAt: 1000,
  });
  recordResolved({
    sessionId: "ses_1",
    requestId: "perm_1",
    toolName: "bash",
    permissionType: "bash",
    patterns: ["rm *"],
    decision: "once",
    auto: true,
    decidedAt: 2000,
  });
  const rows = listResolvedForSession("ses_1");
  expect(rows.length).toBe(1);
  expect(rows[0].asked_at).toBe(1000);
  expect(rows[0].decided_at).toBe(2000);
  expect(rows[0].decision).toBe("once");
  expect(rows[0].auto).toBe(1);
  expect(rows[0].tool_name).toBe("bash");
  expect(JSON.parse(rows[0].patterns)).toEqual(["rm *"]);
});

test("resolved without prior asked inserts a complete row", () => {
  recordResolved({
    sessionId: "ses_2",
    requestId: "perm_2",
    toolName: "edit",
    decision: "reject",
    auto: false,
    askedAt: 500,
    decidedAt: 900,
  });
  const rows = listResolvedForSession("ses_2");
  expect(rows.length).toBe(1);
  expect(rows[0].decision).toBe("reject");
  expect(rows[0].auto).toBe(0);
  expect(rows[0].asked_at).toBe(500);
});

test("recordAsked is idempotent on (session, request)", () => {
  recordAsked({ sessionId: "ses_3", requestId: "perm_3", askedAt: 10 });
  recordAsked({ sessionId: "ses_3", requestId: "perm_3", askedAt: 99 });
  recordResolved({
    sessionId: "ses_3",
    requestId: "perm_3",
    decision: "always",
    auto: false,
  });
  const rows = listResolvedForSession("ses_3");
  expect(rows.length).toBe(1);
  expect(rows[0].asked_at).toBe(10);
});

test("listResolvedForSession returns only resolved, ordered by asked_at", () => {
  recordAsked({ sessionId: "ses_4", requestId: "pending_only", askedAt: 1 });
  recordResolved({
    sessionId: "ses_4",
    requestId: "later",
    decision: "once",
    auto: false,
    askedAt: 300,
  });
  recordResolved({
    sessionId: "ses_4",
    requestId: "earlier",
    decision: "once",
    auto: false,
    askedAt: 100,
  });
  const rows = listResolvedForSession("ses_4");
  expect(rows.map((r) => r.request_id)).toEqual(["earlier", "later"]);
});

test("yaml carries source/kind and decision fields", () => {
  recordResolved({
    sessionId: "ses_5",
    requestId: "perm_5",
    toolName: "bash",
    permissionType: "bash",
    patterns: ["ls *", "cat *"],
    decision: "always",
    auto: true,
    askedAt: 1,
    decidedAt: 2,
  });
  const yaml = permissionEventToYaml(listResolvedForSession("ses_5")[0]);
  expect(yaml).toContain("source: vibekick");
  expect(yaml).toContain("kind: permissions");
  expect(yaml).toContain("decision: always");
  expect(yaml).toContain("auto: true");
  expect(yaml).toContain('- "ls *"');
  expect(yaml).toContain('- "cat *"');
});
