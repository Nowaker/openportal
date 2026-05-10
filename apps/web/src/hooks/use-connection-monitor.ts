import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";

const PROBE_INTERVAL_MS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_URL = "/api/instance/self";

// Three states:
//   - connected       Portal reachable AND its bound opencode is up.
//   - upstream-down   Portal reachable but the bound opencode isn't.
//                     (Portal itself answers /api/instance/self with
//                     `{ instance: null, error: 'active-server-
//                     unreachable' }`.)
//   - disconnected    Portal itself is unreachable (likely got
//                     restarted to ship code, transient network blip).
export type ConnectionStatus = "connected" | "upstream-down" | "disconnected";

// Periodically pings a cheap server endpoint to detect openportal-side
// outages (most common: openportal got restarted to ship code, all open
// tabs would otherwise sit stuck on stale SWR caches with paused polling
// because Bun keep-alive sockets to the dead old process don't immediately
// surface as fetch errors). On disconnect transition: surface state so a
// banner can render. On reconnect transition: globally invalidate every
// SWR key (mutate(() => true)) so all pollers re-fetch the live state in
// one wave instead of waiting up to their refreshInterval.
export function useConnectionMonitor(): ConnectionStatus {
  const { mutate } = useSWRConfig();
  const [status, setStatus] = useState<ConnectionStatus>("connected");

  useEffect(() => {
    let cancelled = false;
    let prev: ConnectionStatus = "connected";

    const probe = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      let next: ConnectionStatus = "disconnected";
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
            };
            if (body?.instance) {
              next = "connected";
            } else if (body?.error === "active-server-unreachable") {
              next = "upstream-down";
            } else {
              // /api/instance/self returned a benign null (no active
              // server selected). The frontend bounce-to-/servers
              // handles this; treat the portal itself as connected.
              next = "connected";
            }
          } catch {
            next = "connected";
          }
        }
      } catch {
        next = "disconnected";
      } finally {
        clearTimeout(timer);
      }
      if (cancelled) return;
      if (next !== prev) {
        // On any transition INTO connected from a degraded state,
        // globally invalidate SWR caches so every poller refetches.
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
