import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveWorkspaceRoot,
  validateTemplateLocation,
} from "./vibekick-template-paths";

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "vibekick-test-ws-a-"));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("resolveWorkspaceRoot", () => {
  test("picks the longest matching workspace root", () => {
    const projectDir = join(workspaceRoot, "webapps", "portal");
    const got = resolveWorkspaceRoot(projectDir, [
      "/some/other/path",
      workspaceRoot,
    ]);
    expect(got).toBe(workspaceRoot);
  });

  test("returns the requested directory when no workspace root matches", () => {
    const outside = "/totally/unrelated/path";
    const got = resolveWorkspaceRoot(outside, [workspaceRoot]);
    expect(got).toBe(outside);
  });
});

describe("validateTemplateLocation (path-traversal guard)", () => {
  test("accepts a valid <workspace>/.vibekick/templates/<slug>.md path", () => {
    const got = validateTemplateLocation(
      join(workspaceRoot, ".vibekick", "templates", "ok.md"),
      [workspaceRoot],
    );
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.workspaceRoot).toBe(workspaceRoot);
    }
  });

  test("rejects paths not ending in .md", () => {
    const got = validateTemplateLocation(
      join(workspaceRoot, ".vibekick", "templates", "ok.txt"),
      [workspaceRoot],
    );
    expect(got.ok).toBe(false);
  });

  test("rejects paths not under .vibekick/templates/", () => {
    const got = validateTemplateLocation(
      join(workspaceRoot, "random", "ok.md"),
      [workspaceRoot],
    );
    expect(got.ok).toBe(false);
  });

  test("rejects paths outside any configured workspace root", () => {
    const got = validateTemplateLocation("/etc/.vibekick/templates/passwd.md", [
      workspaceRoot,
    ]);
    expect(got.ok).toBe(false);
  });

  test("blocks path traversal via ..", () => {
    const malicious = join(
      workspaceRoot,
      "..",
      "..",
      "etc",
      ".vibekick",
      "templates",
      "passwd.md",
    );
    const got = validateTemplateLocation(malicious, [workspaceRoot]);
    expect(got.ok).toBe(false);
  });
});
