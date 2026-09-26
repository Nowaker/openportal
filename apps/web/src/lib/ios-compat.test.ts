import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("iOS composer floor", () => {
  const css = readFileSync(join(import.meta.dir, "../ios-compat.css"), "utf8");
  const composerRule =
    css.match(/html\[data-ios="true"\] \[data-composer-root\] \{([^}]*)\}/)?.[1] ?? "";

  // WebKit under-sizes the composer root once its floor is 0 (about 77px where
  // Chromium resolves 143px), which crops the floating Send column from the
  // top. The floor must fit the toolbar row plus the 90px textarea/button
  // column that AGENTS.md's composer contract requires.
  test("keeps an explicit floor that fits the toolbar and the Send column", () => {
    const floor = Number(composerRule.match(/min-height:\s*(\d+)px/)?.[1] ?? 0);
    expect(floor).toBeGreaterThanOrEqual(44 + 90);
  });

  test("scopes every rule to iOS so Android is untouched", () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((block) => block.split("{")[0]?.trim() ?? "")
      .filter(Boolean)
      .flatMap((list) => list.split(",").map((selector) => selector.trim()));
    expect(selectors.every((selector) => selector.startsWith('html[data-ios="true"]'))).toBe(true);
  });
});
