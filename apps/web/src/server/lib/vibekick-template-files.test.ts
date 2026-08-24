import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deleteTemplate, writeTemplate } from "./vibekick-template-files";
import { scanWorkspaceTemplates } from "./vibekick-template-scan";

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "vibekick-test-ws-a-"));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("writeTemplate + scanWorkspaceTemplates", () => {
  test("round-trips name, description, flags, order, and prompt body", () => {
    const location = join(workspaceRoot, ".vibekick", "templates", "foo.md");
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
    const location = join(workspaceRoot, ".vibekick", "templates", "bare.md");
    mkdirSync(join(workspaceRoot, ".vibekick", "templates"), {
      recursive: true,
    });
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
    mkdirSync(join(workspaceRoot, ".vibekick", "templates"), {
      recursive: true,
    });
    writeFileSync(location, "just a prompt body\n", "utf8");
    const all = scanWorkspaceTemplates(workspaceRoot);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("no-frontmatter");
    expect(all[0].prompt).toBe("just a prompt body");
  });
});

describe("deleteTemplate", () => {
  test("removes the file and is idempotent", () => {
    const location = join(
      workspaceRoot,
      ".vibekick",
      "templates",
      "to-delete.md",
    );
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
