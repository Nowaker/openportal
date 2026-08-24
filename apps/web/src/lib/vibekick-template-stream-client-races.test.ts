import { describe, expect, test } from "bun:test";

import type {
  FsTemplate,
  TemplateScanEvent,
  TemplateSnapshot,
} from "./vibekick-template-contract";
import {
  consumeTemplateScanResponse,
  reconcileTemplateScanProgress,
} from "./vibekick-template-stream-client";

const VERSION = { serverStartedAt: 1_000 } as const;

function fixtureTemplate(name: string): FsTemplate {
  const location = "/workspace/.vibekick/templates/root.md";
  return {
    id: `fs:${location}`,
    name,
    enabled: true,
    init: false,
    defaultOn: false,
    slash: false,
    order: 0,
    prompt: name.toLowerCase(),
    location,
    workspaceRoot: "/workspace",
    scope: ".vibekick/templates/root.md",
  };
}

function frame(event: TemplateScanEvent): string {
  return `${JSON.stringify(event)}\n`;
}

describe("template stream race reconciliation", () => {
  test("ignores a lower-revision terminal snapshot even when its timestamp is newer", () => {
    // Given
    const current: TemplateSnapshot = {
      workspaces: ["/workspace"],
      templates: [fixtureTemplate("Edited root")],
      builtAt: 100,
      ...VERSION,
      revision: 5,
    };

    // When
    const result = reconcileTemplateScanProgress(current, {
      workspaces: ["/workspace"],
      templates: [fixtureTemplate("Pre-edit root")],
      builtAt: 200,
      ...VERSION,
      revision: 4,
      complete: true,
    });

    // Then
    expect(result.stale).toBe(true);
    expect(result.snapshot).toEqual(current);
  });

  test("ignores lower-revision partial progress after a mutation", () => {
    // Given
    const current: TemplateSnapshot = {
      workspaces: ["/workspace"],
      templates: [fixtureTemplate("Edited root")],
      builtAt: 100,
      ...VERSION,
      revision: 5,
    };

    // When
    const result = reconcileTemplateScanProgress(current, {
      workspaces: ["/workspace"],
      templates: [fixtureTemplate("Pre-edit root")],
      removedLocations: [],
      ...VERSION,
      revision: 4,
      complete: false,
    });

    // Then
    expect(result.stale).toBe(true);
    expect(result.snapshot).toEqual(current);
  });
});

describe("template stream resource cleanup", () => {
  test("cancels the response body after a protocol error", async () => {
    // Given
    const encoder = new TextEncoder();
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("not-json\n"));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    // When
    const result = consumeTemplateScanResponse(response, () => {});

    // Then
    await expect(result).rejects.toThrow("invalid JSON");
    expect(cancelled).toBe(true);
  });

  test("cancels the response body when a progress consumer fails", async () => {
    // Given
    const encoder = new TextEncoder();
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              frame({
                type: "start",
                workspaces: ["/workspace"],
                ...VERSION,
                revision: 0,
              }),
            ),
          );
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    // When
    const result = consumeTemplateScanResponse(response, () => {
      throw new Error("consumer failed");
    });

    // Then
    await expect(result).rejects.toThrow("consumer failed");
    expect(cancelled).toBe(true);
  });
});
