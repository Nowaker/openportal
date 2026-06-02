import { describe, expect, test } from "bun:test";

import {
  reviveUnknownFinishSession,
} from "./unknown-finish-reviver";
import { UNKNOWN_FINISH_REVIVE_PROMPT } from "../lib/unknown-finish-reviver";

describe("unknown-finish plugin revive strategy", () => {
  test("uses prompt_async because the HTTP API has no input-free resume", async () => {
    let promptCalls = 0;
    const strategy = await reviveUnknownFinishSession(4096, "ses_1", {
      promptAsync: async () => {
        promptCalls += 1;
      },
    });
    expect(strategy).toBe("prompt_async");
    expect(promptCalls).toBe(1);
  });

  test("passes fallback port and session id to the prompt_async transport", async () => {
    const calls: Array<{ port: number; sessionId: string }> = [];
    await reviveUnknownFinishSession(5001, "ses_b", {
      promptAsync: async (port, sessionId) => {
        calls.push({ port, sessionId });
      },
    });

    expect(calls).toEqual([{ port: 5001, sessionId: "ses_b" }]);
  });

  test("uses the minimal OpenPortal wrapper prompt", () => {
    expect(UNKNOWN_FINISH_REVIVE_PROMPT).toBe(
      "[ openportal: unknown error: Continue working diligently to fulfill all user's tasks. ]",
    );
  });
});
