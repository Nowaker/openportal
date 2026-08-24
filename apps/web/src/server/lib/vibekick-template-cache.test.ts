import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TemplateScanEvent } from "../../lib/vibekick-template-contract";
import {
  applyTemplateUpdate,
  forceTemplateSnapshot,
  getTemplateSnapshot,
  resetTemplateCacheForTests,
  subscribeTemplateScan,
  type TemplateScanSubscription,
} from "./vibekick-template-cache";
import { writeTemplate } from "./vibekick-template-files";

let workspaceRoot: string;
let extraWorkspaceRoots: string[];

function writeFixtureTemplate(location: string, root: string, name: string) {
  return writeTemplate(location, root, {
    name,
    enabled: true,
    init: false,
    defaultOn: false,
    slash: false,
    order: 0,
    prompt: name.toLowerCase(),
  });
}

async function collectRemainingEvents(
  subscription: TemplateScanSubscription,
): Promise<TemplateScanEvent[]> {
  const events: TemplateScanEvent[] = [];
  for (
    let event = await subscription.next();
    event;
    event = await subscription.next()
  ) {
    events.push(event);
  }
  return events;
}

function completedEvent(
  events: readonly TemplateScanEvent[],
): Extract<TemplateScanEvent, { readonly type: "complete" }> | undefined {
  return events.find(
    (
      event,
    ): event is Extract<TemplateScanEvent, { readonly type: "complete" }> =>
      event.type === "complete",
  );
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "vibekick-cache-test-"));
  extraWorkspaceRoots = [];
  resetTemplateCacheForTests();
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  for (const root of extraWorkspaceRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  resetTemplateCacheForTests();
});

describe("filesystem template scan coordinator", () => {
  test("delivers the root batch before the authoritative completion", async () => {
    // Given
    writeFixtureTemplate(
      join(workspaceRoot, ".vibekick", "templates", "root.md"),
      workspaceRoot,
      "Root",
    );
    writeFixtureTemplate(
      join(workspaceRoot, "child", ".vibekick", "templates", "child.md"),
      workspaceRoot,
      "Child",
    );

    // When
    const subscription = subscribeTemplateScan([workspaceRoot], {
      force: true,
    });
    const start = await subscription.next();
    const firstBatch = await subscription.next();

    // Then
    expect(start?.type).toBe("start");
    expect(firstBatch?.type).toBe("batch");
    if (firstBatch?.type !== "batch") return;
    expect(firstBatch.templates.map((template) => template.name)).toEqual([
      "Root",
    ]);
    const remaining = await collectRemainingEvents(subscription);
    const complete = completedEvent(remaining);
    expect(
      complete?.snapshot.templates.map((template) => template.name),
    ).toEqual(["Root", "Child"]);
  });

  test("joins concurrent scans for the same ordered workspace key", async () => {
    // Given
    writeFixtureTemplate(
      join(workspaceRoot, ".vibekick", "templates", "root.md"),
      workspaceRoot,
      "Root",
    );

    // When
    const first = subscribeTemplateScan([workspaceRoot], { force: true });
    const second = subscribeTemplateScan([workspaceRoot], { force: true });
    const [firstEvents, secondEvents] = await Promise.all([
      collectRemainingEvents(first),
      collectRemainingEvents(second),
    ]);

    // Then
    const firstComplete = completedEvent(firstEvents);
    const secondComplete = completedEvent(secondEvents);
    expect(firstComplete?.snapshot.revision).toBe(
      secondComplete?.snapshot.revision,
    );
    expect(firstComplete?.snapshot.builtAt).toBe(
      secondComplete?.snapshot.builtAt,
    );
  });

  test("applies a write to an active candidate before completion", async () => {
    // Given
    const rootLocation = join(
      workspaceRoot,
      ".vibekick",
      "templates",
      "root.md",
    );
    writeFixtureTemplate(rootLocation, workspaceRoot, "Old root");
    writeFixtureTemplate(
      join(workspaceRoot, "child", ".vibekick", "templates", "child.md"),
      workspaceRoot,
      "Child",
    );
    const subscription = subscribeTemplateScan([workspaceRoot], {
      force: true,
    });
    await subscription.next();
    await subscription.next();

    // When
    const updated = writeFixtureTemplate(
      rootLocation,
      workspaceRoot,
      "New root",
    );
    applyTemplateUpdate(updated);
    const remaining = await collectRemainingEvents(subscription);

    // Then
    const complete = completedEvent(remaining);
    expect(complete?.snapshot.templates[0]?.name).toBe("New root");
  });

  test("does not leak a write into an unrelated active workspace scan", async () => {
    // Given
    const otherWorkspace = mkdtempSync(join(tmpdir(), "vibekick-cache-other-"));
    extraWorkspaceRoots.push(otherWorkspace);
    const firstTemplate = writeFixtureTemplate(
      join(workspaceRoot, ".vibekick", "templates", "first.md"),
      workspaceRoot,
      "First",
    );
    writeFixtureTemplate(
      join(otherWorkspace, ".vibekick", "templates", "other.md"),
      otherWorkspace,
      "Other",
    );
    const firstScan = subscribeTemplateScan([workspaceRoot], { force: true });
    const otherScan = subscribeTemplateScan([otherWorkspace], { force: true });
    await firstScan.next();
    await otherScan.next();

    // When
    applyTemplateUpdate(firstTemplate);
    const [firstEvents, otherEvents] = await Promise.all([
      collectRemainingEvents(firstScan),
      collectRemainingEvents(otherScan),
    ]);

    // Then
    expect(firstEvents.at(-1)?.type).toBe("failed");
    expect(
      completedEvent(otherEvents)?.snapshot.templates.map(
        (template) => template.name,
      ),
    ).toEqual(["Other"]);
  });

  test("does not leak a write into an unrelated completed snapshot", async () => {
    // Given
    const otherWorkspace = mkdtempSync(join(tmpdir(), "vibekick-cache-other-"));
    extraWorkspaceRoots.push(otherWorkspace);
    writeFixtureTemplate(
      join(otherWorkspace, ".vibekick", "templates", "other.md"),
      otherWorkspace,
      "Other",
    );
    await forceTemplateSnapshot([otherWorkspace]);
    const firstTemplate = writeFixtureTemplate(
      join(workspaceRoot, ".vibekick", "templates", "first.md"),
      workspaceRoot,
      "First",
    );

    // When
    applyTemplateUpdate(firstTemplate);
    const retained = await getTemplateSnapshot([otherWorkspace]);

    // Then
    expect(retained.templates.map((template) => template.name)).toEqual([
      "Other",
    ]);
  });

  test("retains cached templates under an unreadable descendant", async () => {
    // Given
    const restrictedDirectory = join(workspaceRoot, "restricted");
    writeFixtureTemplate(
      join(restrictedDirectory, ".vibekick", "templates", "retained.md"),
      workspaceRoot,
      "Retained",
    );
    const previous = await forceTemplateSnapshot([workspaceRoot]);
    chmodSync(restrictedDirectory, 0);

    try {
      // When
      const subscription = subscribeTemplateScan([workspaceRoot], {
        force: true,
      });
      const events = await collectRemainingEvents(subscription);
      const complete = completedEvent(events);

      // Then
      expect(events.at(-1)?.type).toBe("complete");
      expect(complete?.snapshot.revision).toBeGreaterThan(previous.revision);
      expect(
        complete?.snapshot.templates.map((template) => template.name),
      ).toEqual(["Retained"]);
    } finally {
      chmodSync(restrictedDirectory, 0o700);
    }
  });

  test("preserves the completed snapshot when a forced scan fails", async () => {
    // Given
    writeFixtureTemplate(
      join(workspaceRoot, ".vibekick", "templates", "root.md"),
      workspaceRoot,
      "Root",
    );
    const completed = await forceTemplateSnapshot([workspaceRoot]);
    rmSync(workspaceRoot, { recursive: true, force: true });

    // When
    const subscription = subscribeTemplateScan([workspaceRoot], {
      force: true,
    });
    const events = await collectRemainingEvents(subscription);
    const retained = await getTemplateSnapshot([workspaceRoot]);

    // Then
    expect(events.at(-1)?.type).toBe("failed");
    expect(retained.revision).toBe(completed.revision);
    expect(retained.templates.map((template) => template.name)).toEqual([
      "Root",
    ]);
  });
});
