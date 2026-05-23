import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { logSystemMessage } from "@/stores/system-messages-store";

const PROBE_INTERVAL_MS = 10_000;
const PROBE_INTERVAL_WHILE_DOWN_MS = 2_000;
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_URL = "/api/instance/self";
// Number of consecutive failed probes before flipping the banner to
// openportal-down. Single isolated failures (browser woke from
// background and the first probe was slow, or a Bun-side HTTP/2
// keep-alive blip) MUST NOT flash the destructive banner.
const FAILURE_THRESHOLD = 2;

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
    let consecutiveFailures = 0;

    const probe = async (trigger: string) => {
      const t0 = performance.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      let probed: ConnectionStatus | null = null;
      let probedReason = "";
      let fetchError: unknown = null;
      let httpStatus: number | null = null;
      try {
        const res = await fetch(PROBE_URL, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        httpStatus = res.status;
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
              probed = "connected";
              probedReason = "health.opencode=up";
            } else if (opencodeHealth === "down") {
              if (body?.lastKnown) {
                probed = "opencode-down";
                probedReason = "health.opencode=down + lastKnown";
              } else {
                probed = "connected";
                probedReason = "health.opencode=down but no lastKnown";
              }
            } else if (body?.error === "active-server-unreachable") {
              probed = "opencode-down";
              probedReason = `error=${body.error}`;
            } else {
              probed = "connected";
              probedReason = `health.opencode=${opencodeHealth ?? "missing"} (defaulting connected)`;
            }
          } catch (parseErr) {
            probed = "connected";
            probedReason = `json parse failed (${(parseErr as Error).message}) but http 2xx, treating connected`;
          }
        } else {
          probedReason = `http ${res.status} ${res.statusText}`;
        }
      } catch (err) {
        fetchError = err;
      } finally {
        clearTimeout(timer);
      }
      const elapsedMs = Math.round(performance.now() - t0);
      if (cancelled) {
        console.log(
          `[connection-monitor] probe cancelled (trigger=${trigger}, ${elapsedMs}ms)`,
        );
        return;
      }
      let next: ConnectionStatus;
      if (probed === null) {
        consecutiveFailures += 1;
        const errMsg =
          fetchError instanceof DOMException && fetchError.name === "AbortError"
            ? `aborted after ${PROBE_TIMEOUT_MS}ms`
            : fetchError instanceof Error
              ? fetchError.message
              : httpStatus !== null
                ? `http ${httpStatus}`
                : "unknown";
        if (consecutiveFailures >= FAILURE_THRESHOLD) {
          next = "openportal-down";
          console.log(
            `[connection-monitor] probe FAILED (trigger=${trigger}, ${elapsedMs}ms, reason=${errMsg}); ${consecutiveFailures} consecutive failures >= threshold ${FAILURE_THRESHOLD} → openportal-down`,
          );
        } else {
          next = prev;
          console.log(
            `[connection-monitor] probe failed (trigger=${trigger}, ${elapsedMs}ms, reason=${errMsg}); ${consecutiveFailures}/${FAILURE_THRESHOLD} consecutive failures, staying ${prev}`,
          );
        }
      } else {
        if (consecutiveFailures > 0) {
          console.log(
            `[connection-monitor] probe recovered (trigger=${trigger}, ${elapsedMs}ms, reason=${probedReason}); resetting ${consecutiveFailures} consecutive failures`,
          );
        } else {
          console.log(
            `[connection-monitor] probe ok (trigger=${trigger}, ${elapsedMs}ms, ${probedReason})`,
          );
        }
        consecutiveFailures = 0;
        next = probed;
      }
      if (next !== prev) {
        console.log(
          `[connection-monitor] state transition: ${prev} → ${next}`,
        );
        // Mirror every state transition to the durable system-messages
        // drawer so the user can audit connectivity history past the
        // 4s toast dwell. System-wide (projectDirectory omitted) so
        // they show under both hamburger (project-filtered) and
        // sidebar (unfiltered) entry points.
        if (next === "connected") {
          logSystemMessage(
            "connection",
            "success",
            prev === "openportal-down"
              ? "OpenPortal reconnected"
              : prev === "opencode-down"
                ? "OpenCode reconnected"
                : "Connection restored",
          );
        } else if (next === "openportal-down") {
          logSystemMessage(
            "connection",
            "error",
            "OpenPortal disconnected",
            "Periodic /api/instance/self probe failed past the failure threshold.",
          );
        } else if (next === "opencode-down") {
          logSystemMessage(
            "connection",
            "warning",
            "OpenCode unreachable",
            "OpenPortal is up but its bound opencode is reporting health=down. Local data still renders; live opencode reads degrade.",
          );
        }
        if (next === "connected" && prev !== "connected") {
          console.log(
            "[connection-monitor] firing global SWR mutate(() => true) to refetch all keys",
          );
          void mutate(() => true);
        }
        prev = next;
        setStatus(next);
      }
    };

    let scheduledTimer: number | null = null;
    const scheduleNext = () => {
      if (cancelled) return;
      const delay =
        prev === "connected"
          ? PROBE_INTERVAL_MS
          : PROBE_INTERVAL_WHILE_DOWN_MS;
      scheduledTimer = window.setTimeout(async () => {
        await probe("interval");
        scheduleNext();
      }, delay);
    };
    const onFocus = () => {
      void probe("focus");
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void probe("visibility");
    };
    const onOnline = () => {
      void probe("online");
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    void (async () => {
      await probe("mount");
      scheduleNext();
    })();

    return () => {
      cancelled = true;
      if (scheduledTimer !== null) window.clearTimeout(scheduledTimer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [mutate]);

  return status;
}
