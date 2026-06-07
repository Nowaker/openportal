import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";
import {
  getServerById,
  listConfiguredServers,
  normalizeWebEndpoint,
  updateServer,
} from "../../lib/server-registry";
import { invalidateLiveEndpoint } from "../../lib/server-resolver";
import { parseBody, parseRouteParam } from "../../lib/validation";

const updateSchema = z.object({
  host: z.string().min(1).max(255).optional(),
  port: z.int().min(1).max(65535).optional(),
  webEndpoint: z.string().max(2048).nullable().optional(),
});

export default defineHandler(async (event) => {
  const id = parseRouteParam(event, "id");
  const existing = getServerById(id);
  if (!existing) throw new HTTPError("Server not found", { status: 404 });

  const body = await parseBody(event, updateSchema);
  const host = body.host?.trim() ?? existing.host;
  const port = body.port ?? existing.port;
  const webEndpoint =
    body.webEndpoint === undefined
      ? existing.webEndpoint
      : normalizeWebEndpoint(body.webEndpoint ?? undefined);

  const duplicate = listConfiguredServers().find(
    (s) => s.id !== id && s.host === host && s.port === port,
  );
  if (duplicate) {
    throw new HTTPError(
      `Another saved server already uses ${host}:${port} (${duplicate.id})`,
      { status: 409 },
    );
  }

  const server = updateServer(id, { host, port, webEndpoint });
  if (!server) throw new HTTPError("Server not found", { status: 404 });
  invalidateLiveEndpoint(id);
  return { server };
});
