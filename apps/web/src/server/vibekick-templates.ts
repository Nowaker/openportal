import { z } from "zod/v4";
import { defineHandler, getMethod, getQuery } from "nitro/h3";
import { parseBody } from "./lib/validation";
import { readPortalConfig } from "./lib/portal-config";
import {
  applyTemplateDelete,
  applyTemplateUpdate,
  deleteTemplate,
  forceRebuildSnapshot,
  getCachedSnapshot,
  resolveWorkspaceRoot,
  scanWorkspaceTemplates,
  templatesForDirectory,
  validateTemplateLocation,
  writeTemplate,
  type FsTemplate,
} from "./lib/vibekick-templates";
import { dirname, resolve, sep } from "path";
import { homedir } from "os";

const writeBodySchema = z.object({
  location: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  enabled: z.boolean(),
  init: z.boolean(),
  slash: z.boolean(),
  order: z.number().int().finite(),
  prompt: z.string(),
});

function listWorkspaces(): string[] {
  return readPortalConfig().directories;
}

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

function sortedTemplates(list: Iterable<FsTemplate>): FsTemplate[] {
  return Array.from(list).sort(
    (a, b) => a.order - b.order || a.scope.localeCompare(b.scope),
  );
}

export default defineHandler(async (event) => {
  const method = getMethod(event);

  if (method === "GET") {
    const query = getQuery(event);
    const directory = typeof query.directory === "string" ? query.directory : null;
    const workspace = typeof query.workspace === "string" ? query.workspace : null;
    const rescan = query.rescan === "1" || query.rescan === "true";

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
    const snapshot = rescan
      ? await forceRebuildSnapshot(workspaces)
      : await getCachedSnapshot(workspaces);
    return {
      workspaces: snapshot.workspaces,
      templates: sortedTemplates(snapshot.templatesByLocation.values()),
      builtAt: snapshot.builtAt,
    };
  }

  if (method === "POST") {
    const body = await parseBody(event, writeBodySchema);
    const validation = validateTemplateLocation(body.location, listWorkspaces());
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
      slash: body.slash,
      order: body.order,
      prompt: body.prompt,
    });
    applyTemplateUpdate(template);
    return { template };
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
    deleteTemplate(location);
    const expanded = resolve(expandTilde(location));
    applyTemplateDelete(expanded);
    applyTemplateDelete(location);
    return { ok: true };
  }

  return new Response("Method not allowed", { status: 405 });
});
