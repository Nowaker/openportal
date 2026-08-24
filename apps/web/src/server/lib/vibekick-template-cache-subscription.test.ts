import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyTemplateDelete,
  forceTemplateSnapshot,
  getTemplateSnapshot,
  resetTemplateCacheForTests,
  subscribeTemplateScan,
} from "./vibekick-template-cache";
import { deleteTemplate, writeTemplate } from "./vibekick-template-files";

let workspaceRoot: string;
let templateLocation: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "vibekick-subscription-"));
  templateLocation = join(workspaceRoot, ".vibekick", "templates", "root.md");
  writeTemplate(templateLocation, workspaceRoot, {
    name: "Root",
    enabled: true,
    init: false,
    defaultOn: false,
    slash: false,
    order: 0,
    prompt: "root",
  });
  resetTemplateCacheForTests();
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  resetTemplateCacheForTests();
});

describe("filesystem template refresh subscriptions", () => {
  test("seeds a joining subscriber with the completed snapshot", async () => {
    // Given
    await forceTemplateSnapshot([workspaceRoot]);
    const active = subscribeTemplateScan([workspaceRoot], { force: true });
    expect((await active.next())?.type).toBe("start");

    // When
    const joining = subscribeTemplateScan([workspaceRoot], { force: false });
    expect((await joining.next())?.type).toBe("start");
    const seeded = await joining.next();

    // Then
    expect(seeded?.type).toBe("batch");
    if (seeded?.type === "batch") {
      expect(seeded.templates.map((template) => template.name)).toEqual([
        "Root",
      ]);
    }
    active.unsubscribe();
    joining.unsubscribe();
  });

  test("serves the completed snapshot while an active refresh fails", async () => {
    // Given
    const completed = await forceTemplateSnapshot([workspaceRoot]);
    const active = subscribeTemplateScan([workspaceRoot], { force: true });
    expect((await active.next())?.type).toBe("start");
    rmSync(workspaceRoot, { recursive: true, force: true });

    // When
    const returned = await getTemplateSnapshot([workspaceRoot]);

    // Then
    expect(returned).toEqual(completed);
    active.unsubscribe();
  });

  test("seeds deletion tombstones for subscribers that join late", async () => {
    // Given
    await forceTemplateSnapshot([workspaceRoot]);
    const active = subscribeTemplateScan([workspaceRoot], { force: true });
    expect((await active.next())?.type).toBe("start");
    applyTemplateDelete(deleteTemplate(templateLocation));

    // When
    const joining = subscribeTemplateScan([workspaceRoot], { force: false });
    expect((await joining.next())?.type).toBe("start");
    const seeded = await joining.next();

    // Then
    expect(seeded?.type).toBe("batch");
    if (seeded?.type === "batch") {
      expect(seeded.templates).toEqual([]);
      expect(seeded.removedLocations).toEqual([templateLocation]);
    }
    active.unsubscribe();
    joining.unsubscribe();
  });
});
