import { describe, expect, test } from "bun:test";

import {
  detectUnknownFinishTerminalFailure,
  UNKNOWN_FINISH_REVIVE_PROMPT,
  UnknownFinishReviveGuard,
} from "./unknown-finish-reviver";

describe("detectUnknownFinishTerminalFailure", () => {
  test("detects terminal assistant finish=unknown with empty content", () => {
    const messages = [
      { info: { id: "msg_u1", role: "user" } },
      {
        info: {
          id: "msg_a1",
          role: "assistant",
          finish: "unknown",
          time: { completed: Date.now() },
        },
        parts: [],
      },
    ];
    const out = detectUnknownFinishTerminalFailure(messages);
    expect(out.shouldRevive).toBe(true);
    expect(out.signature?.startsWith("msg_a1:")).toBe(true);
  });

  test("does not detect when finish is normal", () => {
    const messages = [
      {
        info: {
          id: "msg_a1",
          role: "assistant",
          finish: "stop",
          time: { completed: Date.now() },
        },
        parts: [],
      },
    ];
    const out = detectUnknownFinishTerminalFailure(messages);
    expect(out.shouldRevive).toBe(false);
  });

  test("does not detect when unknown finish has substantial text", () => {
    const messages = [
      {
        info: {
          id: "msg_a1",
          role: "assistant",
          finish: "unknown",
          time: { completed: Date.now() },
        },
        parts: [
          {
            type: "text",
            text: "This completed a real response with meaningful content.",
          },
        ],
      },
    ];
    const out = detectUnknownFinishTerminalFailure(messages);
    expect(out.shouldRevive).toBe(false);
  });
});

describe("UnknownFinishReviveGuard", () => {
  test("blocks repeat attempts for same signature until backoff passes", () => {
    const guard = new UnknownFinishReviveGuard(3, 60_000);
    const key = "4096:ses_1";
    const sig = "msg_1:123:unknown:0";
    expect(guard.shouldAttempt(key, sig, 1_000)).toBe(true);
    guard.recordAttempt(key, sig, 1_000);
    expect(guard.shouldAttempt(key, sig, 5_000)).toBe(false);
    expect(guard.shouldAttempt(key, sig, 7_000)).toBe(true);
  });

  test("allows immediate attempt on new signature for same session", () => {
    const guard = new UnknownFinishReviveGuard(3, 60_000);
    const key = "4096:ses_1";
    guard.recordAttempt(key, "msg_1:123:unknown:0", 1_000);
    expect(guard.shouldAttempt(key, "msg_2:456:unknown:0", 1_100)).toBe(true);
  });
});

describe("revive prompt", () => {
  test("uses required wrapper wording", () => {
    expect(UNKNOWN_FINISH_REVIVE_PROMPT).toBe(
      "[ openportal: unknown error: Continue working diligently to fulfill all user's tasks. ]",
    );
  });
});
