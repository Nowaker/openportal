import { z } from "zod/v4";
import { defineHandler, getMethod, getQuery } from "nitro/h3";
import { parseBody } from "./lib/validation";
import { readPortalConfig } from "./lib/portal-config";
import {
  applyTemplateDelete,
  applyTemplateUpdate,
  forceTemplateSnapshot,
  getTemplateSnapshot,
  subscribeTemplateScan,
} from "./lib/vibekick-template-cache";
import { deleteTemplate, writeTemplate } from "./lib/vibekick-template-files";
import {
  resolveWorkspaceRoot,
  validateTemplateLocation,
} from "./lib/vibekick-template-paths";
import {
  scanWorkspaceTemplates,
  templatesForDirectory,
} from "./lib/vibekick-template-scan";

const writeBodySchema = z.object({
  location: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  enabled: z.boolean(),
  init: z.boolean(),
  defaultOn: z.boolean(),
  slash: z.boolean(),
  order: z.number().int().finite(),
  prompt: z.string(),
});

function listWorkspaces(): string[] {
  return readPortalConfig().directories;
}

function streamTemplateScan(
  workspaces: readonly string[],
  force: boolean,
): Response {
  const subscription = subscribeTemplateScan(workspaces, { force });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const event = await subscription.next();
        if (!event) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        if (event.type === "complete" || event.type === "failed") {
          controller.close();
          subscription.unsubscribe();
        }
      } catch (error) {
        subscription.unsubscribe();
        controller.error(
          error instanceof Error
            ? error
            : new Error("Filesystem template stream failed"),
        );
      }
    },
    cancel() {
      subscription.unsubscribe();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export default defineHandler(async (event) => {
  const method = getMethod(event);

  if (method === "GET") {
    const query = getQuery(event);
    const directory =
      typeof query.directory === "string" ? query.directory : null;
    const workspace =
      typeof query.workspace === "string" ? query.workspace : null;
    const rescan = query.rescan === "1" || query.rescan === "true";
    const stream = query.stream === "1" || query.stream === "true";

    if (directory) {
      const roots = listWorkspaces();
      const root = resolveWorkspaceRoot(directory, roots);
      return {
        directory,
        workspaceRoot: root,
        templates: templatesForDirectory(directory, root),
      };
    }
    if (workspace) {
      return {
        workspaceRoot: workspace,
        templates: scanWorkspaceTemplates(workspace),
      };
    }
    const workspaces = listWorkspaces();
    if (stream) return streamTemplateScan(workspaces, rescan);
    const snapshot = rescan
      ? await forceTemplateSnapshot(workspaces)
      : await getTemplateSnapshot(workspaces);
    return snapshot;
  }

  if (method === "POST") {
    const body = await parseBody(event, writeBodySchema);
    const validation = validateTemplateLocation(
      body.location,
      listWorkspaces(),
    );
    if (!validation.ok) {
      return new Response(JSON.stringify({ error: validation.reason }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const template = writeTemplate(body.location, validation.workspaceRoot, {
      name: body.name,
      description: body.description,
      enabled: body.enabled,
      init: body.init,
      defaultOn: body.defaultOn,
      slash: body.slash,
      order: body.order,
      prompt: body.prompt,
    });
    const version = applyTemplateUpdate(template);
    return { template, ...version };
  }

  if (method === "DELETE") {
    const query = getQuery(event);
    const location = typeof query.location === "string" ? query.location : null;
    if (!location) {
      return new Response(JSON.stringify({ error: "location required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const validation = validateTemplateLocation(location, listWorkspaces());
    if (!validation.ok) {
      return new Response(JSON.stringify({ error: validation.reason }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const expanded = deleteTemplate(location);
    const version = applyTemplateDelete(expanded);
    return { ok: true, ...version };
  }

  return new Response("Method not allowed", { status: 405 });
});
