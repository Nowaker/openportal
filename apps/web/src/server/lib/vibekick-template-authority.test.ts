import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeTemplate } from "./vibekick-template-files";
import { validateTemplateLocation } from "./vibekick-template-paths";
import { templatesForDirectory } from "./vibekick-template-scan";

let workspaceRoot: string;
let outsideRoot: string;

function writeFixtureTemplate(
  location: string,
  name: string,
  order: number,
): void {
  writeTemplate(location, workspaceRoot, {
    name,
    enabled: true,
    init: true,
    defaultOn: false,
    slash: false,
    order,
    prompt: name.toLowerCase(),
  });
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "vibekick-authority-ws-"));
  outsideRoot = mkdtempSync(join(tmpdir(), "vibekick-authority-outside-"));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(outsideRoot, { recursive: true, force: true });
});

describe("filesystem template workspace authority", () => {
  test("selects the longest configured root for a nested workspace", () => {
    // Given
    const nestedRoot = join(workspaceRoot, "nested");
    mkdirSync(nestedRoot, { recursive: true });
    const location = join(nestedRoot, ".vibekick", "templates", "nested.md");

    // When
    const result = validateTemplateLocation(location, [
      workspaceRoot,
      nestedRoot,
    ]);

    // Then
    expect(result).toEqual({ ok: true, workspaceRoot: nestedRoot });
  });

  test("rejects a template path that escapes through a symlinked ancestor", () => {
    // Given
    mkdirSync(join(outsideRoot, ".vibekick", "templates"), {
      recursive: true,
    });
    const link = join(workspaceRoot, "linked");
    symlinkSync(outsideRoot, link, "dir");
    const location = join(link, ".vibekick", "templates", "escape.md");

    // When
    const result = validateTemplateLocation(location, [workspaceRoot]);

    // Then
    expect(result.ok).toBe(false);
  });
});

describe("filesystem template directory priority", () => {
  test("orders inherited templates from workspace root to project leaf", () => {
    // Given
    const projectDirectory = join(workspaceRoot, "webapps", "portal");
    writeFixtureTemplate(
      join(workspaceRoot, ".vibekick", "templates", "root.md"),
      "Root",
      100,
    );
    writeFixtureTemplate(
      join(workspaceRoot, "webapps", ".vibekick", "templates", "mid.md"),
      "Mid",
      0,
    );
    writeFixtureTemplate(
      join(projectDirectory, ".vibekick", "templates", "project.md"),
      "Project",
      -100,
    );

    // When
    const templates = templatesForDirectory(projectDirectory, workspaceRoot);

    // Then
    expect(templates.map((template) => template.name)).toEqual([
      "Root",
      "Mid",
      "Project",
    ]);
  });
});
