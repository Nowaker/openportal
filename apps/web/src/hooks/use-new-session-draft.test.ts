import { describe, expect, test } from "bun:test";
import {
  clearVirtualSessionIfAbandoned,
  draftTextForContext,
} from "./use-new-session-draft";

describe("new-session draft context", () => {
  test("clears the previous project text when the target has no draft", () => {
    expect(draftTextForContext(null, undefined)).toBe("");
  });

  test("prefers an explicit auto prompt for the target project", () => {
    expect(draftTextForContext(null, "continue here")).toBe("continue here");
  });
});

describe("new-session virtual directory cleanup", () => {
  test("clears the virtual directory when the route is abandoned", () => {
    let clearCount = 0;

    clearVirtualSessionIfAbandoned({ current: false }, () => {
      clearCount += 1;
    });

    expect(clearCount).toBe(1);
  });

  test("leaves successful submission cleanup to the submit transaction", () => {
    let clearCount = 0;

    clearVirtualSessionIfAbandoned({ current: true }, () => {
      clearCount += 1;
    });

    expect(clearCount).toBe(0);
  });
});
