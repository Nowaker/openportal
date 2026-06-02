import { beforeEach, describe, expect, test } from "bun:test";

import {
  clearNativeResumeSupportCache,
  pickNativeResumeSupport,
  reviveUnknownFinishSession,
  setNativeResumeSupportForTest,
} from "./unknown-finish-reviver";

describe("unknown-finish plugin revive strategy", () => {
  beforeEach(() => {
    clearNativeResumeSupportCache();
  });

  test("uses native resume when supported", async () => {
    let nativeCalls = 0;
    let promptCalls = 0;
    const strategy = await reviveUnknownFinishSession(4096, "ses_1", {
      nativeResume: async () => {
        nativeCalls += 1;
        return true;
      },
      promptAsync: async () => {
        promptCalls += 1;
      },
    });
    expect(strategy).toBe("native");
    expect(nativeCalls).toBe(1);
    expect(promptCalls).toBe(0);
  });

  test("falls back to prompt_async when native resume not supported", async () => {
    let nativeCalls = 0;
    let promptCalls = 0;
    const strategy = await reviveUnknownFinishSession(4096, "ses_2", {
      nativeResume: async () => {
        nativeCalls += 1;
        return false;
      },
      promptAsync: async () => {
        promptCalls += 1;
      },
    });
    expect(strategy).toBe("prompt_async");
    expect(nativeCalls).toBe(1);
    expect(promptCalls).toBe(1);
  });

  test("skips native probe when cached as unsupported", async () => {
    setNativeResumeSupportForTest(5001, false);
    expect(pickNativeResumeSupport(5001)).toBe(false);

    let nativeCalls = 0;
    let promptCalls = 0;
    const strategy = await reviveUnknownFinishSession(5001, "ses_b", {
      nativeResume: async () => {
        nativeCalls += 1;
        return true;
      },
      promptAsync: async () => {
        promptCalls += 1;
      },
    });

    expect(strategy).toBe("prompt_async");
    expect(nativeCalls).toBe(0);
    expect(promptCalls).toBe(1);
  });
});
