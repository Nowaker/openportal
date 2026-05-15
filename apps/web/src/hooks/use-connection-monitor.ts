import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";

const PROBE_INTERVAL_MS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_URL = "/api/instance/self";

// Three states the rest of the UI cares about:
//   - connected        Both openportal and its bound opencode are
//                      reachable. Steady state.
//   - opencode-down    Openportal answers but reports its bound
//                      opencode as unreachable. Cached / openportal-
//                      owned views (prompts, sessions list from local
//                      cache, settings, server list) still render,
//                      surfaced under a yellow staleness banner.
//                      Renamed from the old "upstream-down" because
//                      "upstream" was ambiguous (could mean upstream
//                      git remote, upstream library, ...).
//   - openportal-down  /api/instance/self itself failed (openportal
//                      restarted to ship code, transient network
//                      blip). Destructive-toned banner; nothing we can
//                      fetch will succeed until it comes back.
//                      Renamed from "disconnected" - "openportal-
//                      down" is concrete and pairs symmetrically with
//                      opencode-down.
export type ConnectionStatus = "connected" | "opencode-down" | "openportal-down";

// Periodically pings /api/instance/self to detect outages on either
// side of the openportal -> opencode bridge:
//
// - openportal-down: fetch throws (process restarted, network blip).
//   The banner takes a destructive tone because nothing useful can
//   load until openportal returns.
//
// - opencode-down: fetch succeeds, body.health.opencode === 'down'.
//   The banner takes a yellow / warning tone because openportal-
//   owned data (prompts archive, server list, settings, persisted
//   sessions list) still renders correctly off cached / local
//   sources; only live opencode reads (session messages, providers,
//   agents) degrade.
//
// On any transition back to 'connected', globally invalidate every
// SWR key (mutate(() => true)) so pollers refetch in one wave
// instead of waiting up to their refreshInterval. Important for the
// opencode-down -> connected case because /api/opencode/{port}/*
// keys were returning errors throughout the outage; without the
// global mutate they'd sit on stale error caches for up to a minute.
export function useConnectionMonitor(): ConnectionStatus {
  const { mutate } = useSWRConfig();
  const [status, setStatus] = useState<ConnectionStatus>("connected");

  useEffect(() => {
    let cancelled = false;
    let prev: ConnectionStatus = "connected";

    const probe = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      let next: ConnectionStatus = "openportal-down";
      try {
        const res = await fetch(PROBE_URL, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (res.ok) {
          try {
            const body = (await res.json()) as {
              instance?: unknown;
              error?: string;
              lastKnown?: unknown;
              health?: { openportal?: string; opencode?: string };
            };
            const opencodeHealth = body?.health?.opencode;
            if (opencodeHealth === "up") {
              next = "connected";
            } else if (opencodeHealth === "down") {
              // Only fly the opencode-down banner when there's an
              // active server context to be cached/stale about. If
              // no server has ever been selected (first-run or no
              // legacy config), the user is on / or about to be
              // bounced to /servers, and a yellow banner would just
              // be noise. body.lastKnown is the active-but-down
              // marker.
              if (body?.lastKnown) {
                next = "opencode-down";
              } else {
                next = "connected";
              }
            } else if (body?.error === "active-server-unreachable") {
              // Fallback for older openportal builds that don't
              // emit health.opencode yet. Keeps the connection
              // monitor working during a rolling upgrade window.
              next = "opencode-down";
            } else {
              next = "connected";
            }
          } catch {
            next = "connected";
          }
        }
      } catch {
        next = "openportal-down";
      } finally {
        clearTimeout(timer);
      }
      if (cancelled) return;
      if (next !== prev) {
        if (next === "connected" && prev !== "connected") {
          void mutate(() => true);
        }
        prev = next;
        setStatus(next);
      }
    };

    const interval = window.setInterval(probe, PROBE_INTERVAL_MS);
    const onFocus = () => {
      void probe();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void probe();
    };
    const onOnline = () => {
      void probe();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    void probe();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [mutate]);

  return status;
}
