import { describe, expect, test } from "bun:test";
import { clearVirtualSessionIfAbandoned } from "./use-new-session-draft";

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
