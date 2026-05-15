// "Is this HTTP request coming from this machine or from somewhere
// else?" - drives the open-in-VSCode local/remote split AND the user-
// presence hint exposed via /api/instance/self that downstream code
// (AI, companion plugin) uses to decide between a GUI sudo prompt
// (when the user is physically at this computer) and a web-mediated
// sudo prompt (when the user is on a remote tailscale peer).
//
// Trust model:
//
//   socket peer is the IP the kernel sees on the inbound TCP socket.
//   For requests arriving through Caddy on this same host the socket
//   peer is always one of THIS HOST's own IPs (loopback when Caddy
//   speaks over 127.0.0.1, the tailnet IP when it speaks over the
//   tailnet interface). X-Forwarded-For from Caddy is authoritative
//   in that case - we trust it and surface the real requester IP.
//
//   For requests arriving directly (no proxy hop) the socket peer IS
//   the real client. Any X-Forwarded-For on a direct connection comes
//   from a peer we do not trust - tailnet peers could otherwise fake
//   isLocal=true by sending X-Forwarded-For: 127.0.0.1. We deliberately
//   IGNORE the header in that case and use the socket peer.
//
//   Trusted-proxy set = this host's own IPs (every interface address
//   plus loopback) plus the env-injected OPENPORTAL_LOCAL_IPS overrides.
//   Reverse proxies must therefore live on this host. If you ever
//   need to support an off-host reverse proxy, extend the trust set
//   via OPENPORTAL_LOCAL_IPS - never weaken the check.
//
// "Local" verdict means the real requester IP (after applying the
// trust check) belongs to THIS HOST's network interfaces or loopback.

import { networkInterfaces } from "node:os";

import { getRequestIP, type HTTPEvent } from "nitro/h3";

const LOOPBACK = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

let cachedLocalIps: Set<string> | null = null;

function getLocalIps(): Set<string> {
  if (cachedLocalIps !== null) return cachedLocalIps;
  const ips = new Set<string>(LOOPBACK);
  try {
    const ifaces = networkInterfaces();
    for (const iface of Object.values(ifaces)) {
      for (const addr of iface ?? []) {
        if (addr.address) ips.add(addr.address.replace("::ffff:", ""));
      }
    }
  } catch {
    // best-effort
  }
  for (const extra of (process.env.OPENPORTAL_LOCAL_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    ips.add(extra);
  }
  cachedLocalIps = ips;
  return cachedLocalIps;
}

function firstForwardedHop(header: string | null): string | null {
  if (!header) return null;
  const first = header.split(",")[0]?.trim() ?? "";
  if (!first) return null;
  if (first.startsWith("[") && first.includes("]")) {
    return first.slice(1, first.indexOf("]"));
  }
  if (first.includes(":") && !first.startsWith("::")) {
    const colons = (first.match(/:/g) ?? []).length;
    if (colons === 1) return first.slice(0, first.indexOf(":"));
  }
  return first;
}

export interface ClientInfo {
  ip: string;
  isLocal: boolean;
  socketPeer: string;
  proxied: boolean;
}

export function detectClient(event: HTTPEvent): ClientInfo {
  const headers = (event as unknown as { headers?: Headers }).headers;
  // getRequestIP() in h3 v2 reads event.req.context.clientAddress ||
  // event.req.ip, which the srvx Bun adapter populates from
  // server.requestIP(request). The previous implementation reached
  // into event.node.req.socket.remoteAddress, which is the H3 v1
  // Node-compat shim - in Bun that shim does not exist and the
  // optional chain returns undefined, defaulting to 127.0.0.1 for
  // every request (including remote tailnet peers). The XFF trust
  // gate then accepted spoofed XFF from anyone, and the presence
  // tracker recorded every browser request as "local". Use the
  // runtime-agnostic h3 helper instead.
  const socketPeer = (getRequestIP(event) ?? "127.0.0.1").replace(
    "::ffff:",
    "",
  );

  const localIps = getLocalIps();
  const socketTrusted = localIps.has(socketPeer);

  const headerHop = socketTrusted
    ? (firstForwardedHop(headers?.get("x-forwarded-for") ?? null) ??
        headers?.get("x-real-ip") ??
        null)
    : null;

  const ip = (headerHop ?? socketPeer).replace("::ffff:", "");
  const isLocal = localIps.has(ip);
  return { ip, isLocal, socketPeer, proxied: headerHop !== null };
}
