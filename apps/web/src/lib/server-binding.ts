// Client half of `?server=<id>` permalink binding.
//
// The problem this exists to solve: `useInstanceStore` is persisted to
// localStorage, so on a cold load it already holds the PREVIOUSLY active
// server before a single byte comes back from openportal. Every
// port-keyed hook reads `instance.port` off it and fires immediately, so
// a permalink for server B spent its whole first render fetching server
// A's sessions, messages and event stream - the user watched the wrong
// machine's data while the URL said otherwise.
//
// Two mechanisms, both needed:
//
//   1. `requestedId` - what the CURRENT URL asks for, read straight off
//      window.location at module init so it is correct before React's
//      first render, and kept in sync by the /_app route afterwards.
//      `usePort()` refuses to hand out a port while the store's instance
//      disagrees with it, which starves every port-keyed SWR key of a
//      key. That is the guarantee: no request can reach the wrong
//      opencode, no matter which component mounts first.
//
//   2. `ensureBoundToServer()` - awaited in the route's beforeLoad, so
//      binding completes before the layout (and its data hooks) mount at
//      all. One POST that both switches the active server and hands back
//      the /api/instance/self body, which we seed into SWR: the layout
//      then mounts already knowing who it is talking to instead of
//      racing a second fetch.

import { create } from "zustand";
import { mutate as globalMutate } from "swr";
import { useInstanceStore } from "@/stores/instance-store";
import type { ServerFallbackReason } from "@/lib/server-permalink";

export const SELF_INSTANCE_KEY = "/api/instance/self";

export type ServerBindOutcome =
  | { status: "bound"; alreadyActive: boolean }
  // openportal itself did not answer. Not a permalink problem, and
  // bouncing to /servers would be pointless because that page needs the
  // same server we just failed to reach. Carry on with what we have and
  // let the connection-monitor banner own the UX.
  | { status: "unverified" }
  | { status: "unknown"; requestedId: string }
  | {
      status: "unreachable";
      requestedId: string;
      label?: string;
      host?: string;
      port?: number;
    };

interface ServerBindingState {
  requestedId: string | null;
}

function readRequestedServerFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = new URLSearchParams(window.location.search).get("server");
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export const useServerBindingStore = create<ServerBindingState>()(() => ({
  requestedId: readRequestedServerFromUrl(),
}));

export function setRequestedServerId(id: string | null): void {
  if (useServerBindingStore.getState().requestedId === id) return;
  useServerBindingStore.setState({ requestedId: id });
}

interface SelfInstancePayload {
  id: string;
  name: string;
  port: number;
  protocol?: "http" | "https";
  hostname?: string;
  webEndpoint?: string;
}

interface BindResponse {
  ok: boolean;
  alreadyActive?: boolean;
  reason?: ServerFallbackReason;
  requestedId?: string;
  label?: string;
  host?: string;
  port?: number;
  self?: { instance: SelfInstancePayload | null };
}

// Ids this browser session has already put on the wire successfully.
// Combined with "the store still holds that id", it lets repeat
// navigations under the same ?server= skip the round-trip entirely -
// which is the whole of requirement "already-active must not thrash".
const confirmed = new Set<string>();
const inFlight = new Map<string, Promise<ServerBindOutcome>>();

// Called by /servers after its own POST /api/servers/active, so the
// navigation that immediately follows an Open click does not pay for a
// bind that just happened by another name.
export function markServerConfirmed(id: string): void {
  confirmed.add(id);
}

export function isServerConfirmed(id: string): boolean {
  return confirmed.has(id);
}

export async function ensureBoundToServer(
  id: string,
): Promise<ServerBindOutcome> {
  const current = useInstanceStore.getState().instance;
  if (current?.id === id && confirmed.has(id)) {
    return { status: "bound", alreadyActive: true };
  }
  const existing = inFlight.get(id);
  if (existing) return existing;
  const pending = performBind(id).finally(() => {
    inFlight.delete(id);
  });
  inFlight.set(id, pending);
  return pending;
}

async function performBind(id: string): Promise<ServerBindOutcome> {
  let payload: BindResponse;
  try {
    const res = await fetch("/api/servers/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) return { status: "unverified" };
    payload = (await res.json()) as BindResponse;
  } catch {
    return { status: "unverified" };
  }

  if (!payload.ok) {
    if (payload.reason === "unknown") return { status: "unknown", requestedId: id };
    if (payload.reason === "unreachable") {
      return {
        status: "unreachable",
        requestedId: id,
        label: payload.label,
        host: payload.host,
        port: payload.port,
      };
    }
    return { status: "unverified" };
  }

  confirmed.add(id);
  const self = payload.self;
  if (self) {
    // Seed rather than revalidate. useSelfInstance() is about to mount
    // with a 60s deduping interval; without this it would either serve
    // the previous server's cached body (and the layout's sync effect
    // would write that stale instance straight back over the one we
    // just bound) or spend another round-trip re-asking a question this
    // response already answered.
    void globalMutate(SELF_INSTANCE_KEY, self, { revalidate: false });
  }
  const instance = self?.instance;
  if (instance) {
    useInstanceStore.getState().setInstance({
      id: instance.id,
      name: instance.name,
      port: instance.port,
      protocol: instance.protocol,
      hostname: instance.hostname,
      webEndpoint: instance.webEndpoint,
    });
  }
  return { status: "bound", alreadyActive: payload.alreadyActive === true };
}
