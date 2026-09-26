import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closePromptDbForTesting } from "./prompt-db";
import {
  getCachedSessions,
  invalidateSessionsCache,
  sessionsGeneration,
  setCachedSessions,
} from "./sessions-cache";

let dir: string;

beforeEach(() => {
  closePromptDbForTesting();
  dir = mkdtempSync(join(tmpdir(), "sessions-cache-"));
  process.env.OPENPORTAL_DB_PATH = join(dir, "test.db");
  invalidateSessionsCache();
});

afterEach(() => {
  closePromptDbForTesting();
  rmSync(dir, { recursive: true, force: true });
});

test("a fetch that finishes after an invalidation does not repopulate the cache", () => {
  const startedAt = sessionsGeneration();
  invalidateSessionsCache(4096);

  setCachedSessions(4096, [{ id: "ses_a", title: "New session" }], startedAt);

  expect(getCachedSessions(4096)).toBeNull();
});

test("a fetch with no invalidation in between is cached", () => {
  const startedAt = sessionsGeneration();

  setCachedSessions(4096, [{ id: "ses_a", title: "Generated title" }], startedAt);

  expect(getCachedSessions(4096)).toEqual([{ id: "ses_a", title: "Generated title" }]);
});
