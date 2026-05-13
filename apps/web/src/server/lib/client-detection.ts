// "Is this HTTP request coming from this machine or from somewhere
// else?" - drives the open-in-VSCode local/remote split: local
// requests get a vscode:// link with the canonical filesystem path,
// remote requests need a per-requestor path mapping so the link
// targets a path that exists on the user's REMOTE machine.
//
// We can't trust event.node.req.socket.remoteAddress on its own
// because the request typically arrives via Caddy on this same host
// (TLS termination), so the socket peer is always 127.0.0.1 even
// when the user is on their laptop. The reverse-proxy MUST set
// X-Forwarded-For; we read that first and fall back to the socket
// peer only when no proxy header is present.
//
// "Local" means the requesting IP is one of:
//   - loopback (127.0.0.1, ::1)
//   - any IP literal listed in OPENPORTAL_LOCAL_IPS (comma-separated)
//     — env-injected at boot for tailscale / LAN addresses that
//     belong to this host (e.g. 100.105.229.19 over tailscale,
//     192.168.10.10 over LAN). The exact list is operator-controlled.

import { networkInterfaces } from "node:os";

import type { HTTPEvent } from "nitro/h3";

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
}

export function detectClient(event: HTTPEvent): ClientInfo {
  const fromHeader =
    firstForwardedHop(
      (event as unknown as { headers?: Headers }).headers?.get(
        "x-forwarded-for",
      ) ?? null,
    ) ??
    (event as unknown as { headers?: Headers }).headers?.get("x-real-ip") ??
    null;
  const fromSocket =
    (event as unknown as {
      node?: { req?: { socket?: { remoteAddress?: string } } };
    }).node?.req?.socket?.remoteAddress ?? "127.0.0.1";
  const ip = (fromHeader ?? fromSocket).replace("::ffff:", "");
  const isLocal = getLocalIps().has(ip);
  return { ip, isLocal };
}
