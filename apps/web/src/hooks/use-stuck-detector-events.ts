import { useEffect } from "react";
import { logSystemMessage } from "@/stores/system-messages-store";

const URL = "/api/stuck-detector/events/stream";

interface VerdictTransitionEvent {
  type: "verdict-transition";
  sessionID: string;
  prev: "idle" | "in-progress" | "stuck";
  next: "idle" | "in-progress" | "stuck";
  stuck_cause: string | null;
  at: number;
}

interface JournalActionEvent {
  type: "journal-action";
  id: number;
  sessionID: string;
  action: string;
  cause: string;
  ok: boolean;
  reason?: string;
  at: number;
}

type StuckDetectorEvent = VerdictTransitionEvent | JournalActionEvent;

function shortSid(sid: string): string {
  return sid.length > 12 ? `${sid.slice(0, 12)}\u2026` : sid;
}

function handleEvent(e: StuckDetectorEvent): void {
  if (e.type === "verdict-transition") {
    if (e.next === "stuck") {
      logSystemMessage(
        "stuck-detector",
        "warning",
        `Session ${shortSid(e.sessionID)} became stuck`,
        e.stuck_cause
          ? `Cause: ${e.stuck_cause} (was ${e.prev}).`
          : `Was ${e.prev}.`,
      );
    } else if (e.prev === "stuck") {
      logSystemMessage(
        "stuck-detector",
        "success",
        `Session ${shortSid(e.sessionID)} recovered`,
        `Now ${e.next} (was stuck).`,
      );
    }
    return;
  }
  if (e.type === "journal-action") {
    const level = e.ok ? "info" : "error";
    const verb = e.ok ? "dispatched" : "failed";
    logSystemMessage(
      "stuck-detector",
      level,
      `Recovery ${verb}: ${e.action} on ${shortSid(e.sessionID)}`,
      `Cause: ${e.cause}${e.reason ? `. ${e.reason}` : ""}`,
    );
  }
}

// EventSource wrapper that opens a single SSE connection per browser
// tab and routes events to logSystemMessage. Auto-reconnects on
// close via the standard EventSource semantics; the server-side
// heartbeat (every 30s) keeps the connection from getting dropped by
// intermediate proxies. We intentionally do NOT log connection
// open/close to the drawer - useConnectionMonitor already covers
// portal connectivity; this stream is downstream of that and would
// flap on every portal restart.
export function useStuckDetectorEvents(): void {
  useEffect(() => {
    if (typeof window === "undefined" || !("EventSource" in window)) {
      return;
    }
    const source = new EventSource(URL);
    source.onmessage = (evt) => {
      if (!evt.data) return;
      try {
        const parsed = JSON.parse(evt.data) as StuckDetectorEvent;
        if (parsed && typeof parsed === "object" && "type" in parsed) {
          handleEvent(parsed);
        }
      } catch {
        // malformed frame
      }
    };
    source.onerror = () => {
      // EventSource auto-reconnects; nothing to do
    };
    return () => {
      source.close();
    };
  }, []);
}
