import { z } from "zod/v4";
import { defineHandler, getMethod, getQuery } from "nitro/h3";
import { parseBody } from "./lib/validation";
import { readPortalConfig } from "./lib/portal-config";
import {
  deleteTemplate,
  resolveWorkspaceRoot,
  scanWorkspaceTemplates,
  templatesForDirectory,
  validateTemplateLocation,
  writeTemplate,
  type FsTemplate,
} from "./lib/vibekick-templates";

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

function listAcrossWorkspaces(): FsTemplate[] {
  const roots = listWorkspaces();
  const all: FsTemplate[] = [];
  for (const root of roots) {
    all.push(...scanWorkspaceTemplates(root));
  }
  return all;
}

export default defineHandler(async (event) => {
  const method = getMethod(event);

  if (method === "GET") {
    const query = getQuery(event);
    const directory = typeof query.directory === "string" ? query.directory : null;
    const workspace = typeof query.workspace === "string" ? query.workspace : null;

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
    return {
      workspaces: listWorkspaces(),
      templates: listAcrossWorkspaces(),
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
    const template = writeTemplate(body.location, {
      name: body.name,
      description: body.description,
      enabled: body.enabled,
      init: body.init,
      slash: body.slash,
      order: body.order,
      prompt: body.prompt,
    });
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
    return { ok: true };
  }

  return new Response("Method not allowed", { status: 405 });
});
