import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";

const PROBE_INTERVAL_MS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_URL = "/api/instance/self";

export type ConnectionStatus = "connected" | "disconnected";

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
    let prevOk = true;

    const probe = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      let ok = false;
      try {
        const res = await fetch(PROBE_URL, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        ok = res.ok;
      } catch {
        ok = false;
      } finally {
        clearTimeout(timer);
      }
      if (cancelled) return;
      if (ok) {
        if (!prevOk) {
          prevOk = true;
          setStatus("connected");
          void mutate(() => true);
        }
      } else if (prevOk) {
        prevOk = false;
        setStatus("disconnected");
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
