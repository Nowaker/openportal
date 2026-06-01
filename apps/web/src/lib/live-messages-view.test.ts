import { describe, expect, test } from "bun:test";

import {
  buildLiveRow,
  classifyMessageType,
  reconcileRows,
  shortenSessionTitle,
} from "./live-messages-view";

describe("live-messages-view", () => {
  test("shortenSessionTitle trims to 32 chars with ellipsis", () => {
    expect(shortenSessionTitle("short title", 32)).toBe("short title");
    expect(shortenSessionTitle("x".repeat(40), 32)).toBe(`${"x".repeat(29)}...`);
  });

  test("classifyMessageType maps assistant finish/error variants", () => {
    expect(classifyMessageType({ id: "m1", role: "assistant", finish: "stop" })).toBe("assistant");
    expect(classifyMessageType({ id: "m2", role: "assistant", finish: "length" })).toBe("assistant:incomplete");
    expect(classifyMessageType({ id: "m3", role: "assistant", error: { name: "APIError" } })).toBe("assistant:error");
    expect(classifyMessageType({ id: "m4", role: "user" })).toBe("user");
  });

  test("reconcileRows emits placeholder first, then final text for same message id", () => {
    const seen = new Map<string, string>();
    const initial = buildLiveRow({
      sessionId: "ses_1",
      sessionTitle: "demo",
      timestampMs: 1,
      message: { info: { id: "msg_1", role: "assistant" }, parts: [] },
    });
    const withPlaceholder = reconcileRows({ rows: [], seenByMessageId: seen, incoming: initial });
    expect(withPlaceholder).toHaveLength(1);
    expect(withPlaceholder[0]?.text).toBe("(no text parts)");

    const final = buildLiveRow({
      sessionId: "ses_1",
      sessionTitle: "demo",
      timestampMs: 2,
      message: {
        info: { id: "msg_1", role: "assistant" },
        parts: [{ type: "text", text: "Now deploy." }],
      },
    });
    const withFinal = reconcileRows({
      rows: withPlaceholder,
      seenByMessageId: seen,
      incoming: final,
    });
    expect(withFinal).toHaveLength(2);
    expect(withFinal[1]?.text).toBe("Now deploy.");
  });
});
