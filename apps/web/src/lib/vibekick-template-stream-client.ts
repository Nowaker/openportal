import {
  isTemplateVersionOlder,
  sortFsTemplates,
  templateScanEventSchema,
  templateSnapshotSchema,
  type FsTemplate,
  type TemplateScanEvent,
  type TemplateSnapshot,
  type TemplateVersion,
} from "./vibekick-template-contract";

type PartialTemplateScanProgress = {
  readonly workspaces: readonly string[];
  readonly templates: readonly FsTemplate[];
  readonly removedLocations: readonly string[];
  readonly serverStartedAt: number;
  readonly revision: number;
  readonly complete: false;
};

type CompleteTemplateScanProgress = TemplateSnapshot & {
  readonly complete: true;
};

export type TemplateScanProgress =
  | PartialTemplateScanProgress
  | CompleteTemplateScanProgress;

export type TemplateScanReconciliation = {
  readonly snapshot: TemplateSnapshot;
  readonly stale: boolean;
};

export class TemplateStreamProtocolError extends Error {
  override readonly name = "TemplateStreamProtocolError";
}

export class TemplateStreamRemoteError extends Error {
  override readonly name = "TemplateStreamRemoteError";
}

function assertNever(event: never): never {
  throw new TemplateStreamProtocolError(
    `Unknown filesystem template stream event: ${JSON.stringify(event)}`,
  );
}

function hasSameWorkspaces(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((workspace, index) => workspace === right[index])
  );
}

export function reconcileTemplateScanProgress(
  current: unknown,
  progress: TemplateScanProgress,
): TemplateScanReconciliation {
  const parsedCurrent = templateSnapshotSchema.safeParse(current);
  const reusableCurrent =
    parsedCurrent.success &&
    hasSameWorkspaces(parsedCurrent.data.workspaces, progress.workspaces)
      ? parsedCurrent.data
      : null;
  if (reusableCurrent && isTemplateVersionOlder(progress, reusableCurrent)) {
    return { snapshot: reusableCurrent, stale: true };
  }
  if (progress.complete) {
    return {
      snapshot: {
        workspaces: progress.workspaces,
        templates: progress.templates,
        builtAt: progress.builtAt,
        serverStartedAt: progress.serverStartedAt,
        revision: progress.revision,
      },
      stale: false,
    };
  }
  const templatesByLocation = new Map<string, FsTemplate>();
  if (reusableCurrent) {
    for (const template of reusableCurrent.templates) {
      templatesByLocation.set(template.location, template);
    }
  }
  for (const location of progress.removedLocations) {
    templatesByLocation.delete(location);
  }
  for (const template of progress.templates) {
    templatesByLocation.set(template.location, template);
  }
  return {
    snapshot: {
      workspaces: progress.workspaces,
      templates: sortFsTemplates(templatesByLocation.values()),
      builtAt: reusableCurrent?.builtAt ?? 0,
      serverStartedAt: progress.serverStartedAt,
      revision: progress.revision,
    },
    stale: false,
  };
}

export async function consumeTemplateScanResponse(
  response: Response,
  onProgress: (progress: TemplateScanProgress) => void | Promise<void>,
): Promise<TemplateSnapshot> {
  if (!response.ok) {
    throw new TemplateStreamRemoteError(
      `Filesystem template scan request failed: ${response.status}`,
    );
  }
  if (!response.body) {
    throw new TemplateStreamProtocolError(
      "Filesystem template scan response has no body",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const discovered = new Map<string, FsTemplate>();
  const removedLocations = new Set<string>();
  let workspaces: readonly string[] | null = null;
  let version: TemplateVersion | null = null;
  let buffer = "";
  let completedSnapshot: TemplateSnapshot | null = null;

  const handleLine = async (line: string): Promise<void> => {
    if (!line.trim()) return;
    let rawEvent: unknown;
    try {
      rawEvent = JSON.parse(line);
    } catch (error) {
      throw new TemplateStreamProtocolError(
        `Filesystem template stream emitted invalid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`,
      );
    }
    const parsed = templateScanEventSchema.safeParse(rawEvent);
    if (!parsed.success) {
      throw new TemplateStreamProtocolError(
        `Filesystem template stream emitted an invalid event: ${parsed.error.message}`,
      );
    }
    const event: TemplateScanEvent = parsed.data;
    switch (event.type) {
      case "start":
        workspaces = event.workspaces;
        version = event;
        await onProgress({
          workspaces,
          templates: sortFsTemplates(discovered.values()),
          removedLocations: [],
          ...version,
          complete: false,
        });
        return;
      case "batch":
        if (!workspaces) {
          throw new TemplateStreamProtocolError(
            "Filesystem template stream emitted a batch before start",
          );
        }
        if (version && isTemplateVersionOlder(event, version)) return;
        version = event;
        for (const location of event.removedLocations) {
          discovered.delete(location);
          removedLocations.add(location);
        }
        for (const template of event.templates) {
          removedLocations.delete(template.location);
          discovered.set(template.location, template);
        }
        await onProgress({
          workspaces,
          templates: sortFsTemplates(discovered.values()),
          removedLocations: [...removedLocations],
          ...version,
          complete: false,
        });
        return;
      case "complete":
        if (!workspaces) {
          throw new TemplateStreamProtocolError(
            "Filesystem template stream completed before start",
          );
        }
        completedSnapshot = event.snapshot;
        await onProgress({
          ...event.snapshot,
          complete: true,
        });
        return;
      case "failed":
        throw new TemplateStreamRemoteError(event.error);
      default:
        assertNever(event);
    }
  };

  try {
    while (!completedSnapshot) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        await handleLine(line);
        if (completedSnapshot) break;
      }
      if (chunk.done) {
        if (buffer.trim()) await handleLine(buffer);
        break;
      }
    }
    if (!completedSnapshot) {
      throw new TemplateStreamProtocolError(
        "Filesystem template stream ended before completion",
      );
    }
    return completedSnapshot;
  } catch (error) {
    await Promise.allSettled([reader.cancel(error)]);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
