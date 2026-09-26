import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closePromptDbForTesting } from "./prompt-db";
import {
  applySessionEvent,
  getCachedSessions,
  invalidateSessionsCache,
  sessionsFetchStart,
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

const renamed = (title: string) => ({
  type: "session.updated",
  properties: { sessionID: "ses_a", info: { id: "ses_a", title } },
});

test("a fetch that finishes after an invalidation does not repopulate the cache", () => {
  const started = sessionsFetchStart();
  invalidateSessionsCache(4096);

  setCachedSessions(4096, [{ id: "ses_a", title: "New session" }], started);

  expect(getCachedSessions(4096)).toBeNull();
});

test("a fetch with no invalidation in between is cached", () => {
  setCachedSessions(4096, [{ id: "ses_a", title: "Generated title" }], sessionsFetchStart());

  expect(getCachedSessions(4096)).toEqual([{ id: "ses_a", title: "Generated title" }]);
});

test("session.updated patches its row in place, keeping the other rows and fields", () => {
  setCachedSessions(
    4096,
    [{ id: "ses_a", title: "New session", directory: "/w" }, { id: "ses_b", title: "b" }],
    sessionsFetchStart(),
  );

  applySessionEvent(4096, renamed("Generated title"));

  expect(getCachedSessions(4096)).toEqual([
    { id: "ses_a", title: "Generated title", directory: "/w" },
    { id: "ses_b", title: "b" },
  ]);
});

test("a fetch that started before a rename keeps the rename rather than undoing it", () => {
  setCachedSessions(4096, [{ id: "ses_a", title: "New session" }], sessionsFetchStart());
  const started = sessionsFetchStart();

  applySessionEvent(4096, renamed("Generated title"));
  setCachedSessions(4096, [{ id: "ses_a", title: "New session" }], started);

  expect(getCachedSessions(4096)).toEqual([{ id: "ses_a", title: "Generated title" }]);
});

test("session.updated for a row the list lacks invalidates it", () => {
  setCachedSessions(4096, [{ id: "ses_b", title: "b" }], sessionsFetchStart());

  applySessionEvent(4096, renamed("Brand new"));

  expect(getCachedSessions(4096)).toBeNull();
});

test("session.created and session.deleted invalidate the list", () => {
  for (const type of ["session.created", "session.deleted"]) {
    setCachedSessions(4096, [{ id: "ses_a", title: "a" }], sessionsFetchStart());
    applySessionEvent(4096, { type, properties: { info: { id: "ses_a" } } });
    expect(getCachedSessions(4096)).toBeNull();
  }
});
