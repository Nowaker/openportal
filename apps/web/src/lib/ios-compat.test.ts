import { describe, expect, test } from "bun:test";
import { isIOS, isIOSZoomed } from "./ios-compat";

describe("iOS compatibility boundary", () => {
  test.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5, true],
    ["Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", 5, true],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", 5, true],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", 0, false],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5, false],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 10, false],
  ])("detects %s with %i touch points", (userAgent, maxTouchPoints, expected) => {
    // Given a browser identity, when classified, then only iOS opts in.
    expect(isIOS({ userAgent, maxTouchPoints })).toBe(expected);
  });

  test.each([
    ["iPhone", 1, false],
    ["iPhone", 1.005, false],
    ["iPhone", 2, true],
    ["iPhone", 0.8, true],
    ["Android", 2, false],
  ])("freezes only iOS pinch layout for %s at scale %f", (userAgent, scale, expected) => {
    expect(isIOSZoomed({ userAgent, maxTouchPoints: 5 }, { scale })).toBe(expected);
  });

  test("keeps the innerHeight fallback when visualViewport is unavailable", () => {
    expect(isIOSZoomed({ userAgent: "iPhone", maxTouchPoints: 5 }, null)).toBe(false);
  });
});
