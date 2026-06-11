import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deleteTemplate,
  resolveWorkspaceRoot,
  scanWorkspaceTemplates,
  templatesForDirectory,
  validateTemplateLocation,
  writeTemplate,
} from "./vibekick-templates";

let workspaceRoot: string;
let secondWorkspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "vibekick-test-ws-a-"));
  secondWorkspaceRoot = mkdtempSync(join(tmpdir(), "vibekick-test-ws-b-"));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(secondWorkspaceRoot, { recursive: true, force: true });
});

describe("writeTemplate + scanWorkspaceTemplates", () => {
  test("round-trips name, description, flags, order, and prompt body", () => {
    const location = join(
      workspaceRoot,
      ".vibekick",
      "templates",
      "foo.md",
    );
    const written = writeTemplate(location, workspaceRoot, {
      name: "Foo > Bar",
      description: "Round-trip test",
      enabled: true,
      init: true,
      defaultOn: true,
      slash: false,
      order: 5,
      prompt: "Do the thing.\nThen the other thing.",
    });
    expect(written.name).toBe("Foo > Bar");
    expect(written.description).toBe("Round-trip test");
    expect(written.enabled).toBe(true);
    expect(written.init).toBe(true);
    expect(written.defaultOn).toBe(true);
    expect(written.slash).toBe(false);
    expect(written.order).toBe(5);
    expect(written.prompt).toBe("Do the thing.\nThen the other thing.");
    expect(written.id).toBe(`fs:${location}`);
    expect(written.workspaceRoot).toBe(workspaceRoot);

    const all = scanWorkspaceTemplates(workspaceRoot);
    expect(all).toHaveLength(1);
    expect(all[0].location).toBe(location);
    expect(all[0].name).toBe("Foo > Bar");
  });

  test("missing optional fields default to enabled:true, init:false, defaultOn:false, slash:false, order:0", () => {
    const location = join(
      workspaceRoot,
      ".vibekick",
      "templates",
      "bare.md",
    );
    mkdirSync(join(workspaceRoot, ".vibekick", "templates"), { recursive: true });
    writeFileSync(location, "---\nname: Bare\n---\nbody only\n", "utf8");
    const all = scanWorkspaceTemplates(workspaceRoot);
    expect(all).toHaveLength(1);
    expect(all[0].enabled).toBe(true);
    expect(all[0].init).toBe(false);
    expect(all[0].defaultOn).toBe(false);
    expect(all[0].slash).toBe(false);
    expect(all[0].order).toBe(0);
    expect(all[0].name).toBe("Bare");
  });

  test("file with no frontmatter falls back to slug name + body-as-prompt", () => {
    const location = join(
      workspaceRoot,
      ".vibekick",
      "templates",
      "no-frontmatter.md",
    );
    mkdirSync(join(workspaceRoot, ".vibekick", "templates"), { recursive: true });
    writeFileSync(location, "just a prompt body\n", "utf8");
    const all = scanWorkspaceTemplates(workspaceRoot);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("no-frontmatter");
    expect(all[0].prompt).toBe("just a prompt body");
  });

  test("scans recursively across multiple subdirectories", () => {
    writeTemplate(join(workspaceRoot, ".vibekick", "templates", "root.md"), workspaceRoot, {
      name: "Root",
      enabled: true,
      init: false,
      defaultOn: false,
      slash: false,
      order: 0,
      prompt: "root body",
    });
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
      {
        name: "Deep",
        enabled: true,
        init: false,
        defaultOn: false,
        slash: false,
        order: 0,
        prompt: "deep body",
      },
    );
    const all = scanWorkspaceTemplates(workspaceRoot);
    expect(all).toHaveLength(2);
    const names = all.map((t) => t.name).sort();
    expect(names).toEqual(["Deep", "Root"]);
  });

  test("sorts results by order then scope", () => {
    writeTemplate(join(workspaceRoot, ".vibekick", "templates", "a.md"), workspaceRoot, {
      name: "A high order",
      enabled: true,
      init: false,
      defaultOn: false,
      slash: false,
      order: 10,
      prompt: "a",
    });
    writeTemplate(join(workspaceRoot, ".vibekick", "templates", "b.md"), workspaceRoot, {
      name: "B low order",
      enabled: true,
      init: false,
      defaultOn: false,
      slash: false,
      order: 1,
      prompt: "b",
    });
    const all = scanWorkspaceTemplates(workspaceRoot);
    expect(all[0].name).toBe("B low order");
    expect(all[1].name).toBe("A high order");
  });
});

describe("deleteTemplate", () => {
  test("removes the file and is idempotent", () => {
    const location = join(workspaceRoot, ".vibekick", "templates", "to-delete.md");
    writeTemplate(location, workspaceRoot, {
      name: "ToDelete",
      enabled: true,
      init: false,
      defaultOn: false,
      slash: false,
      order: 0,
      prompt: "x",
    });
    expect(scanWorkspaceTemplates(workspaceRoot)).toHaveLength(1);
    deleteTemplate(location);
    expect(scanWorkspaceTemplates(workspaceRoot)).toHaveLength(0);
    // idempotent
    deleteTemplate(location);
    expect(scanWorkspaceTemplates(workspaceRoot)).toHaveLength(0);
  });
});

describe("templatesForDirectory", () => {
  test("walks upward from a project directory to the workspace root", () => {
    writeTemplate(join(workspaceRoot, ".vibekick", "templates", "root.md"), workspaceRoot, {
      name: "Root",
      enabled: true,
      init: false,
      defaultOn: false,
      slash: false,
      order: 0,
      prompt: "r",
    });
    const projectDir = join(workspaceRoot, "webapps", "portal");
    writeTemplate(join(projectDir, ".vibekick", "templates", "project.md"), workspaceRoot, {
      name: "Project",
      enabled: true,
      init: false,
      defaultOn: false,
      slash: false,
      order: 0,
      prompt: "p",
    });
    writeTemplate(
      join(workspaceRoot, "webapps", ".vibekick", "templates", "mid.md"),
      workspaceRoot,
      {
        name: "Mid",
        enabled: true,
        init: false,
        defaultOn: false,
        slash: false,
        order: 0,
        prompt: "m",
      },
    );
    const stack = templatesForDirectory(projectDir, workspaceRoot);
    const names = stack.map((t) => t.name);
    expect(names).toEqual(["Project", "Mid", "Root"]);
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
    const got = validateTemplateLocation(
      "/etc/.vibekick/templates/passwd.md",
      [workspaceRoot],
    );
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
