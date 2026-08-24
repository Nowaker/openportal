import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { TemplateScanEvent } from "../../lib/vibekick-template-contract";
import {
  applyTemplateUpdate,
  forceTemplateSnapshot,
  refreshCompletedTemplateSnapshot,
  resetTemplateCacheForTests,
  subscribeTemplateScan,
  type TemplateScanSubscription,
} from "./vibekick-template-cache";
import { writeTemplate } from "./vibekick-template-files";
import { normalizeWorkspaceRoot } from "./vibekick-template-paths";

let workspaceRoot: string;

function writeFixture(location: string, name: string) {
  return writeTemplate(location, workspaceRoot, {
    name,
    enabled: true,
    init: false,
    defaultOn: false,
    slash: false,
    order: 0,
    prompt: name.toLowerCase(),
  });
}

async function collectEvents(
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

function completedSnapshot(events: readonly TemplateScanEvent[]) {
  const event = events.find((candidate) => candidate.type === "complete");
  return event?.type === "complete" ? event.snapshot : null;
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "vibekick-cache-race-"));
  resetTemplateCacheForTests();
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  resetTemplateCacheForTests();
});

describe("filesystem template scan coordinator races", () => {
  test("joins a non-force subscriber to an active forced scan", async () => {
    // Given
    writeFixture(
      join(workspaceRoot, ".vibekick", "templates", "root.md"),
      "Root",
    );
    await forceTemplateSnapshot([workspaceRoot]);
    writeFixture(
      join(workspaceRoot, "child", ".vibekick", "templates", "child.md"),
      "Child",
    );
    const forced = subscribeTemplateScan([workspaceRoot], { force: true });
    const forcedStart = await forced.next();

    // When
    const ordinary = subscribeTemplateScan([workspaceRoot], { force: false });
    const [forcedEvents, ordinaryEvents] = await Promise.all([
      collectEvents(forced),
      collectEvents(ordinary),
    ]);
    const forcedSnapshot = completedSnapshot(forcedEvents);
    const ordinarySnapshot = completedSnapshot(ordinaryEvents);

    // Then
    expect(forcedStart?.type).toBe("start");
    expect(ordinarySnapshot?.revision).toBe(forcedSnapshot?.revision);
    expect(
      ordinarySnapshot?.templates.map((template) => template.name),
    ).toEqual(["Root", "Child"]);
  });

  test("publishes an active-scan mutation before later directory batches", async () => {
    // Given
    const rootLocation = join(
      workspaceRoot,
      ".vibekick",
      "templates",
      "root.md",
    );
    writeFixture(rootLocation, "Old root");
    writeFixture(
      join(workspaceRoot, "child", ".vibekick", "templates", "child.md"),
      "Child",
    );
    const subscription = subscribeTemplateScan([workspaceRoot], {
      force: true,
    });
    await subscription.next();
    await subscription.next();

    // When
    const updated = writeFixture(rootLocation, "New root");
    applyTemplateUpdate(updated);
    const nextEvent = await subscription.next();
    await collectEvents(subscription);

    // Then
    expect(nextEvent?.type).toBe("batch");
    if (nextEvent?.type !== "batch") return;
    expect(nextEvent.templates.map((template) => template.name)).toContain(
      "New root",
    );
  });

  test("publishes normalized workspace identities", async () => {
    // Given
    writeFixture(
      join(workspaceRoot, ".vibekick", "templates", "root.md"),
      "Root",
    );
    const alias = `${workspaceRoot}/../${basename(workspaceRoot)}`;

    // When
    const snapshot = await forceTemplateSnapshot([alias]);

    // Then
    expect(snapshot.workspaces).toEqual([normalizeWorkspaceRoot(alias)]);
    expect(snapshot.templates[0]?.workspaceRoot).toBe(
      normalizeWorkspaceRoot(alias),
    );
  });

  test("retains cached rows when a .vibekick directory becomes inaccessible", async () => {
    // Given
    const metadataDirectory = join(workspaceRoot, "restricted", ".vibekick");
    writeFixture(
      join(metadataDirectory, "templates", "retained.md"),
      "Retained",
    );
    await forceTemplateSnapshot([workspaceRoot]);
    chmodSync(metadataDirectory, 0);

    try {
      // When
      const subscription = subscribeTemplateScan([workspaceRoot], {
        force: true,
      });
      const events = await collectEvents(subscription);

      // Then
      expect(
        completedSnapshot(events)?.templates.map((template) => template.name),
      ).toEqual(["Retained"]);
    } finally {
      chmodSync(metadataDirectory, 0o700);
    }
  });

  test("retains unreadable rows when the configured workspace list changes", async () => {
    // Given
    const metadataDirectory = join(workspaceRoot, "restricted", ".vibekick");
    writeFixture(
      join(metadataDirectory, "templates", "retained.md"),
      "Retained",
    );
    await forceTemplateSnapshot([workspaceRoot]);
    const addedWorkspace = mkdtempSync(join(tmpdir(), "vibekick-added-root-"));
    chmodSync(metadataDirectory, 0);

    try {
      // When
      const events = await collectEvents(
        subscribeTemplateScan([workspaceRoot, addedWorkspace], { force: true }),
      );

      // Then
      expect(
        completedSnapshot(events)?.templates.map((template) => template.name),
      ).toEqual(["Retained"]);
    } finally {
      chmodSync(metadataDirectory, 0o700);
      rmSync(addedWorkspace, { recursive: true, force: true });
    }
  });

  test("re-homes unreadable rows when workspace ownership changes", async () => {
    // Given
    const nestedRoot = join(workspaceRoot, "nested");
    const metadataDirectory = join(nestedRoot, ".vibekick");
    writeTemplate(
      join(metadataDirectory, "templates", "retained.md"),
      nestedRoot,
      {
        name: "Retained",
        enabled: true,
        init: false,
        defaultOn: false,
        slash: false,
        order: 0,
        prompt: "retained",
      },
    );
    await forceTemplateSnapshot([workspaceRoot, nestedRoot]);
    chmodSync(metadataDirectory, 0);

    try {
      // When
      const snapshot = await forceTemplateSnapshot([workspaceRoot]);

      // Then
      expect(snapshot.templates[0]?.workspaceRoot).toBe(workspaceRoot);
      expect(snapshot.templates[0]?.scope).toBe(
        join("nested", ".vibekick", "templates", "retained.md"),
      );
    } finally {
      chmodSync(metadataDirectory, 0o700);
    }
  });

  test("does not let periodic refresh supersede an active workspace scan", async () => {
    // Given
    writeFixture(
      join(workspaceRoot, ".vibekick", "templates", "root.md"),
      "Root",
    );
    await forceTemplateSnapshot([workspaceRoot]);
    const otherWorkspace = mkdtempSync(join(tmpdir(), "vibekick-periodic-"));
    writeTemplate(
      join(otherWorkspace, ".vibekick", "templates", "other.md"),
      otherWorkspace,
      {
        name: "Other",
        enabled: true,
        init: false,
        defaultOn: false,
        slash: false,
        order: 0,
        prompt: "other",
      },
    );
    const active = subscribeTemplateScan([otherWorkspace], { force: true });
    await active.next();

    try {
      // When
      await refreshCompletedTemplateSnapshot();
      const events = await collectEvents(active);

      // Then
      expect(events.at(-1)?.type).toBe("complete");
      expect(
        completedSnapshot(events)?.templates.map((template) => template.name),
      ).toEqual(["Other"]);
    } finally {
      rmSync(otherWorkspace, { recursive: true, force: true });
    }
  });
});
