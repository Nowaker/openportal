import { EventEmitter } from "node:events";

export type VerdictKind = "idle" | "in-progress" | "stuck";

export interface VerdictTransitionEvent {
  type: "verdict-transition";
  sessionID: string;
  prev: VerdictKind;
  next: VerdictKind;
  stuck_cause: string | null;
  at: number;
}

export interface JournalActionEvent {
  type: "journal-action";
  id: number;
  sessionID: string;
  action: string;
  cause: string;
  ok: boolean;
  reason?: string;
  at: number;
}

export type StuckDetectorEvent =
  | VerdictTransitionEvent
  | JournalActionEvent;

// Process-wide event bus. The stuck-detector verdicts + journal Nitro
// plugins publish here; the SSE endpoint subscribes per browser
// client. Single EventEmitter instance is fine - we are inside a
// single Nitro process. maxListeners bumped because every connected
// portal tab is a long-lived subscriber.
const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export function emitStuckEvent(event: StuckDetectorEvent): void {
  emitter.emit("event", event);
}

export function subscribeStuckEvents(
  listener: (event: StuckDetectorEvent) => void,
): () => void {
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
}
