import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  archivePrompt,
  clearSessionMetaCacheForTesting,
  getPromptById,
  listPrompts,
} from "./prompt-archive";
import { closePromptDbForTesting } from "./prompt-db";

let dbDir: string;

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "openportal-archive-test-"));
  process.env.OPENPORTAL_DB_PATH = join(dbDir, "archive.db");
  closePromptDbForTesting();
  clearSessionMetaCacheForTesting();
});

afterEach(() => {
  closePromptDbForTesting();
  rmSync(dbDir, { recursive: true, force: true });
  delete process.env.OPENPORTAL_DB_PATH;
});

const baseInput = {
  port: 12345,
  sessionId: "ses_test_001",
  projectPathOverride: "/home/user/projects/foo",
  parentSessionIdOverride: null,
  source: "prompt" as const,
};

describe("archivePrompt", () => {
  test("inserts a valid prompt and returns the row", async () => {
    const row = await archivePrompt({
      ...baseInput,
      rawText: "Implement a tree view in the sidebar with collapsible groups.",
      modelProvider: "anthropic",
      modelId: "claude-opus-4-7",
    });
    expect(row).not.toBeNull();
    expect(row!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(row!.raw_text).toContain("tree view");
    expect(row!.model_provider).toBe("anthropic");
    expect(row!.model_id).toBe("claude-opus-4-7");
    expect(row!.parent_session_id).toBeNull();
    expect(row!.source).toBe("prompt");
    expect(row!.project_path).toBe("/home/user/projects/foo");
  });

  test("returns null and does not insert when filter says skip", async () => {
    const row = await archivePrompt({
      ...baseInput,
      rawText: "Continue",
    });
    expect(row).toBeNull();
    expect(listPrompts({}).rows).toHaveLength(0);
  });

  test("filters ralph/ultrawork noise out of raw_text but preserves it in raw_text_unfiltered", async () => {
    const input = `<system-reminder>noise</system-reminder>
Implement search filtering in the prompt archive UI.`;
    const row = await archivePrompt({ ...baseInput, rawText: input });
    expect(row).not.toBeNull();
    expect(row!.raw_text).toBe(
      "Implement search filtering in the prompt archive UI.",
    );
    expect(row!.raw_text_unfiltered).toContain("<system-reminder>");
  });

  test("redacts inline credential token in both raw_text and raw_text_unfiltered", async () => {
    const input = "Check the key sk-proj-abcdefghijklmnopqrstuvwxyz for me";
    const row = await archivePrompt({ ...baseInput, rawText: input });
    expect(row).not.toBeNull();
    expect(row!.raw_text).toContain("[REDACTED:length=");
    expect(row!.raw_text).not.toContain("sk-proj-abcdef");
    expect(row!.raw_text_unfiltered).toContain("[REDACTED:length=");
    expect(row!.raw_text_unfiltered).not.toContain("sk-proj-abcdef");
  });

  test("stores parent_session_id when override provided", async () => {
    const row = await archivePrompt({
      ...baseInput,
      parentSessionIdOverride: "ses_parent_xyz",
      rawText: "This is a subagent session prompt.",
    });
    expect(row!.parent_session_id).toBe("ses_parent_xyz");
  });
});

describe("getPromptById", () => {
  test("returns null for unknown id", () => {
    expect(getPromptById("does-not-exist")).toBeNull();
  });

  test("round-trips an inserted row", async () => {
    const inserted = await archivePrompt({
      ...baseInput,
      rawText: "Add a hamburger menu entry called Prompt history.",
    });
    expect(inserted).not.toBeNull();
    const fetched = getPromptById(inserted!.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(inserted!.id);
    expect(fetched!.raw_text).toBe(inserted!.raw_text);
  });
});

describe("listPrompts", () => {
  async function seedThree() {
    await archivePrompt({
      ...baseInput,
      sessionId: "ses_A",
      projectPathOverride: "/projects/alpha",
      rawText: "First prompt in alpha session A.",
    });
    await archivePrompt({
      ...baseInput,
      sessionId: "ses_B",
      projectPathOverride: "/projects/beta",
      rawText: "Second prompt in beta session B.",
    });
    await archivePrompt({
      ...baseInput,
      sessionId: "ses_A",
      projectPathOverride: "/projects/alpha",
      rawText: "Third prompt in alpha session A.",
    });
  }

  test("returns rows newest-first", async () => {
    await seedThree();
    const r = listPrompts({});
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0].raw_text).toContain("Third");
    expect(r.rows[2].raw_text).toContain("First");
  });

  test("filters by project_path", async () => {
    await seedThree();
    const r = listPrompts({ project: "/projects/alpha" });
    expect(r.rows).toHaveLength(2);
    expect(r.rows.every((row) => row.project_path === "/projects/alpha")).toBe(
      true,
    );
  });

  test("filters by session_id", async () => {
    await seedThree();
    const r = listPrompts({ session: "ses_B" });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].session_id).toBe("ses_B");
  });

  test("FTS5 search matches raw_text content", async () => {
    await seedThree();
    const r = listPrompts({ q: "alpha" });
    expect(r.rows).toHaveLength(2);
    expect(r.rows.every((row) => row.raw_text.includes("alpha"))).toBe(true);
  });

  test("FTS5 search supports multi-word AND", async () => {
    await seedThree();
    const r = listPrompts({ q: "Third alpha" });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].raw_text).toContain("Third");
  });

  test("respects limit and emits a cursor for pagination", async () => {
    await archivePrompt({ ...baseInput, rawText: "Row one for pagination test." });
    await archivePrompt({ ...baseInput, rawText: "Row two for pagination test." });
    await archivePrompt({ ...baseInput, rawText: "Row three for pagination test." });
    const first = listPrompts({ limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const next = listPrompts({ limit: 2, cursor: first.nextCursor! });
    expect(next.rows).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
  });
});
