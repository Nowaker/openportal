import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeTemplate } from "./vibekick-template-files";
import {
  scanWorkspaceTemplateBatches,
  scanWorkspaceTemplates,
  templatesForDirectory,
} from "./vibekick-template-scan";

let workspaceRoot: string;
let secondWorkspaceRoot: string;

function templateInput(name: string, prompt: string, order = 0) {
  return {
    name,
    enabled: true,
    init: false,
    defaultOn: false,
    slash: false,
    order,
    prompt,
  };
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "vibekick-test-ws-a-"));
  secondWorkspaceRoot = mkdtempSync(join(tmpdir(), "vibekick-test-ws-b-"));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(secondWorkspaceRoot, { recursive: true, force: true });
});

describe("scanWorkspaceTemplates recursive scan", () => {
  test("scans recursively across multiple subdirectories", () => {
    writeTemplate(
      join(workspaceRoot, ".vibekick", "templates", "root.md"),
      workspaceRoot,
      templateInput("Root", "root body"),
    );
    writeTemplate(
      join(
        workspaceRoot,
        "deep",
        "nested",
        "project",
        ".vibekick",
        "templates",
        "deep.md",
      ),
      workspaceRoot,
      templateInput("Deep", "deep body"),
    );
    const all = scanWorkspaceTemplates(workspaceRoot);
    expect(all).toHaveLength(2);
    const names = all.map((t) => t.name).sort();
    expect(names).toEqual(["Deep", "Root"]);
  });

  test("prioritizes shallow template directories before YAML order", () => {
    writeTemplate(
      join(workspaceRoot, ".vibekick", "templates", "root.md"),
      workspaceRoot,
      templateInput("Root", "root", 100),
    );
    writeTemplate(
      join(workspaceRoot, "project", ".vibekick", "templates", "project.md"),
      workspaceRoot,
      templateInput("Project", "project", -100),
    );
    writeTemplate(
      join(
        workspaceRoot,
        "project",
        "package",
        ".vibekick",
        "templates",
        "package.md",
      ),
      workspaceRoot,
      templateInput("Package", "package", -200),
    );

    const names = scanWorkspaceTemplates(workspaceRoot).map((t) => t.name);

    expect(names).toEqual(["Root", "Project", "Package"]);
  });
});

describe("scanWorkspaceTemplateBatches", () => {
  test("streams every workspace root before any child directory", async () => {
    writeTemplate(
      join(workspaceRoot, ".vibekick", "templates", "root-a.md"),
      workspaceRoot,
      templateInput("Root A", "root a"),
    );
    writeTemplate(
      join(secondWorkspaceRoot, ".vibekick", "templates", "root-b.md"),
      secondWorkspaceRoot,
      templateInput("Root B", "root b"),
    );
    writeTemplate(
      join(workspaceRoot, "child", ".vibekick", "templates", "child.md"),
      workspaceRoot,
      templateInput("Child", "child"),
    );

    const streamedNames: string[] = [];
    for await (const batch of scanWorkspaceTemplateBatches([
      workspaceRoot,
      secondWorkspaceRoot,
    ])) {
      streamedNames.push(...batch.templates.map((template) => template.name));
    }

    expect(streamedNames).toEqual(["Root A", "Root B", "Child"]);
  });

  test("sorts results by order then scope", () => {
    writeTemplate(
      join(workspaceRoot, ".vibekick", "templates", "a.md"),
      workspaceRoot,
      templateInput("A high order", "a", 10),
    );
    writeTemplate(
      join(workspaceRoot, ".vibekick", "templates", "b.md"),
      workspaceRoot,
      templateInput("B low order", "b", 1),
    );
    const all = scanWorkspaceTemplates(workspaceRoot);
    expect(all[0].name).toBe("B low order");
    expect(all[1].name).toBe("A high order");
  });
});

describe("templatesForDirectory", () => {
  test("returns inherited templates in workspace-root-first priority", () => {
    writeTemplate(
      join(workspaceRoot, ".vibekick", "templates", "root.md"),
      workspaceRoot,
      templateInput("Root", "r"),
    );
    const projectDir = join(workspaceRoot, "webapps", "portal");
    writeTemplate(
      join(projectDir, ".vibekick", "templates", "project.md"),
      workspaceRoot,
      templateInput("Project", "p"),
    );
    writeTemplate(
      join(workspaceRoot, "webapps", ".vibekick", "templates", "mid.md"),
      workspaceRoot,
      templateInput("Mid", "m"),
    );
    const stack = templatesForDirectory(projectDir, workspaceRoot);
    const names = stack.map((t) => t.name);
    expect(names).toEqual(["Root", "Mid", "Project"]);
  });

  test("returns empty when directory is outside the workspace root", () => {
    const stack = templatesForDirectory(secondWorkspaceRoot, workspaceRoot);
    expect(stack).toEqual([]);
  });

  test("returns empty when directory does not exist", () => {
    const stack = templatesForDirectory(
      join(workspaceRoot, "does", "not", "exist"),
      workspaceRoot,
    );
    expect(stack).toEqual([]);
  });
});
