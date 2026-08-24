import { describe, expect, test } from "bun:test";

import type {
  FsTemplate,
  TemplateScanEvent,
  TemplateSnapshot,
} from "./vibekick-template-contract";
import {
  consumeTemplateScanResponse,
  reconcileTemplateScanProgress,
  type TemplateScanProgress,
} from "./vibekick-template-stream-client";

const SERVER_STARTED_AT = 1_000;

function version(revision: number, serverStartedAt = SERVER_STARTED_AT) {
  return { serverStartedAt, revision };
}

function fixtureTemplate(name: string, scope: string): FsTemplate {
  const location = `/workspace/${scope}`;
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
    scope,
  };
}

function frame(event: TemplateScanEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function responseFromChunks(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

describe("consumeTemplateScanResponse", () => {
  test("publishes a shallow batch before the response completes", async () => {
    // Given
    const root = fixtureTemplate("Root", ".vibekick/templates/root.md");
    const child = fixtureTemplate(
      "Child",
      "child/.vibekick/templates/child.md",
    );
    const snapshot: TemplateSnapshot = {
      workspaces: ["/workspace"],
      templates: [root, child],
      builtAt: 123,
      ...version(4),
    };
    const encoder = new TextEncoder();
    const completionGate = Promise.withResolvers<void>();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(
            encoder.encode(
              frame({
                type: "start",
                workspaces: ["/workspace"],
                ...version(3),
              }),
            ),
          );
          controller.enqueue(
            encoder.encode(
              frame({
                type: "batch",
                templates: [root],
                removedLocations: [],
                ...version(3),
              }),
            ),
          );
          await completionGate.promise;
          controller.enqueue(
            encoder.encode(
              frame({
                type: "batch",
                templates: [child],
                removedLocations: [],
                ...version(3),
              }),
            ),
          );
          controller.enqueue(
            encoder.encode(frame({ type: "complete", snapshot })),
          );
          controller.close();
        },
      }),
    );
    let firstProgressResolve:
      | ((progress: TemplateScanProgress) => void)
      | null = null;
    const firstProgress = new Promise<TemplateScanProgress>((resolve) => {
      firstProgressResolve = resolve;
    });
    let completed = false;

    // When
    const resultPromise = consumeTemplateScanResponse(response, (progress) => {
      if (progress.templates.length === 1) firstProgressResolve?.(progress);
    }).then((result) => {
      completed = true;
      return result;
    });
    const early = await firstProgress;

    // Then
    expect(early.templates.map((template) => template.name)).toEqual(["Root"]);
    expect(completed).toBe(false);
    completionGate.resolve();
    const result = await resultPromise;
    expect(result).toEqual(snapshot);
  });

  test("parses an event split across response chunks", async () => {
    // Given
    const root = fixtureTemplate("Root", ".vibekick/templates/root.md");
    const completeFrame = frame({
      type: "complete",
      snapshot: {
        workspaces: ["/workspace"],
        templates: [root],
        builtAt: 123,
        ...version(1),
      },
    });
    const splitAt = Math.floor(completeFrame.length / 2);
    const response = responseFromChunks([
      frame({ type: "start", workspaces: ["/workspace"], ...version(0) }),
      completeFrame.slice(0, splitAt),
      completeFrame.slice(splitAt),
    ]);

    // When
    const result = await consumeTemplateScanResponse(response, () => {});

    // Then
    expect(result.templates.map((template) => template.name)).toEqual(["Root"]);
  });

  test("rejects premature EOF without pruning the last progress", async () => {
    // Given
    const root = fixtureTemplate("Root", ".vibekick/templates/root.md");
    const response = responseFromChunks([
      frame({ type: "start", workspaces: ["/workspace"], ...version(0) }),
      frame({
        type: "batch",
        templates: [root],
        removedLocations: [],
        ...version(0),
      }),
    ]);
    const progress: TemplateScanProgress[] = [];

    // When
    const result = consumeTemplateScanResponse(response, (update) => {
      progress.push(update);
    });

    // Then
    await expect(result).rejects.toThrow("ended before completion");
    expect(progress.at(-1)?.templates.map((template) => template.name)).toEqual(
      ["Root"],
    );
  });
});

describe("reconcileTemplateScanProgress", () => {
  test("preserves stale rows during progress and prunes them on completion", () => {
    // Given
    const root = fixtureTemplate("Root", ".vibekick/templates/root.md");
    const child = fixtureTemplate(
      "Child",
      "child/.vibekick/templates/child.md",
    );
    const current: TemplateSnapshot = {
      workspaces: ["/workspace"],
      templates: [root, child],
      builtAt: 100,
      ...version(4),
    };

    // When
    const partial = reconcileTemplateScanProgress(current, {
      workspaces: ["/workspace"],
      templates: [{ ...root, name: "Updated root" }],
      removedLocations: [],
      ...version(4),
      complete: false,
    });
    const complete = reconcileTemplateScanProgress(partial.snapshot, {
      workspaces: ["/workspace"],
      templates: [{ ...root, name: "Updated root" }],
      builtAt: 200,
      ...version(5),
      complete: true,
    });

    // Then
    expect(partial.snapshot.templates.map((template) => template.name)).toEqual(
      ["Updated root", "Child"],
    );
    expect(
      complete.snapshot.templates.map((template) => template.name),
    ).toEqual(["Updated root"]);
  });

  test("accepts a newer snapshot after the server revision counter resets", () => {
    // Given
    const root = fixtureTemplate("Root", ".vibekick/templates/root.md");
    const current: TemplateSnapshot = {
      workspaces: ["/workspace"],
      templates: [root],
      builtAt: 100,
      ...version(9),
    };

    // When
    const result = reconcileTemplateScanProgress(current, {
      workspaces: ["/workspace"],
      templates: [{ ...root, name: "After restart" }],
      builtAt: 200,
      ...version(1, SERVER_STARTED_AT + 1),
      complete: true,
    });

    // Then
    expect(result.stale).toBe(false);
    expect(result.snapshot.templates[0]?.name).toBe("After restart");
  });

  test("ignores an older terminal frame from a racing request", () => {
    // Given
    const root = fixtureTemplate("Root", ".vibekick/templates/root.md");
    const current: TemplateSnapshot = {
      workspaces: ["/workspace"],
      templates: [root],
      builtAt: 200,
      ...version(9),
    };

    // When
    const result = reconcileTemplateScanProgress(current, {
      workspaces: ["/workspace"],
      templates: [{ ...root, name: "Stale root" }],
      builtAt: 150,
      ...version(8),
      complete: true,
    });

    // Then
    expect(result.stale).toBe(true);
    expect(result.snapshot).toEqual(current);
  });
});
