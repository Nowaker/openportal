import {
  defineHandler,
  getRequestURL,
  getMethod,
  getRequestHeaders,
  readRawBody,
  type H3Event,
} from "nitro/h3";
import {
  fetchOpencode,
  resolveLiveTarget,
} from "../server/lib/opencode-client";
import { basicAuthHeader } from "../server/lib/server-discovery";
import {
  buildServerOrigin,
  getActiveServer,
  getServerById,
} from "../server/lib/server-registry";

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-length",
  // Bun's fetch auto-decompresses upstream responses (Bun >=1.0), so the
  // body we forward is already plain text/JSON. Forwarding the upstream's
  // `Content-Encoding: gzip` would lie to the downstream client and cause
  // strict HTTP clients (Undici, @opencode-ai/sdk) to abort the response
  // with zlib's "incorrect header check" when they try to decode plain JSON
  // as gzip. Stripping it makes the proxy round-trip honest.
  "content-encoding",
]);

function filterRequestHeaders(headers: Record<string, string | undefined>): Headers {
  const out = new Headers();
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== "string") continue;
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    out.set(k, v);
  }
  return out;
}

function resolveTargetPort(event: H3Event): {
  port: number;
  rest: string;
  via: string;
} | { error: string; status: number } {
  const url = getRequestURL(event);
  const pathname = url.pathname;
  const activePrefix = "/opencode/active/";
  const serverPrefix = "/opencode/server/";
  if (pathname.startsWith(activePrefix)) {
    const server = getActiveServer();
    if (!server) {
      return {
        error: "No active OpenCode server selected.",
        status: 503,
      };
    }
    const rest = "/" + pathname.slice(activePrefix.length);
    return { port: server.port, rest, via: `active:${server.id}` };
  }
  if (pathname.startsWith(serverPrefix)) {
    const tail = pathname.slice(serverPrefix.length);
    const slashIdx = tail.indexOf("/");
    const serverId = slashIdx < 0 ? tail : tail.slice(0, slashIdx);
    const rest = slashIdx < 0 ? "/" : tail.slice(slashIdx);
    if (!serverId) {
      return { error: "Server ID required.", status: 400 };
    }
    const server = getServerById(serverId);
    if (!server) {
      return {
        error: `No configured server with id '${serverId}'`,
        status: 404,
      };
    }
    return { port: server.port, rest, via: `server:${serverId}` };
  }
  return { error: "Bridge route mismatch", status: 404 };
}

export default defineHandler(async (event) => {
  const resolution = resolveTargetPort(event);
  if ("error" in resolution) {
    return new Response(
      JSON.stringify({ error: resolution.error }),
      {
        status: resolution.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const { port, rest, via } = resolution;
  const url = getRequestURL(event);
  const fullPath = rest + url.search;
  const method = getMethod(event);

  const reqHeaders = getRequestHeaders(event);
  const acceptHeader = reqHeaders["accept"];
  const isSSE =
    typeof acceptHeader === "string" &&
    acceptHeader.toLowerCase().includes("text/event-stream");

  if (isSSE) {
    const target = await resolveLiveTarget(port);
    const upstreamUrl = `${buildServerOrigin(target.protocol, target.host, target.port)}${fullPath}`;
    const headers = filterRequestHeaders(reqHeaders);
    if (target.auth && !headers.has("authorization")) {
      const auth = basicAuthHeader(target.auth);
      headers.set("Authorization", auth.Authorization);
    }
    const upstream = await fetch(upstreamUrl, { method, headers });
    if (!upstream.ok || !upstream.body) {
      return new Response(
        JSON.stringify({
          error: `SSE upstream failed: HTTP ${upstream.status}`,
          path: fullPath,
        }),
        {
          status: upstream.status || 502,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive",
        "X-OpenPortal-Compat-Via": via,
      },
    });
  }

  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : ((await readRawBody(event, false)) as unknown as
          | Uint8Array
          | undefined);
  const headers = filterRequestHeaders(reqHeaders);
  const init: RequestInit = {
    method,
    headers,
    body: body ? (body as BodyInit) : undefined,
  };
  const upstream = await fetchOpencode(port, fullPath, init);
  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    outHeaders.set(key, value);
  });
  outHeaders.set("X-OpenPortal-Compat-Via", via);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
});
