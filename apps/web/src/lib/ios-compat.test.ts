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
  const rule = (selector: string) =>
    css.match(new RegExp(`html\\[data-ios="true"\\] \\[${selector}\\] \\{([^}]*)\\}`))?.[1] ?? "";

  // WebKit cannot resolve the textarea's percentage min-height inside the
  // composer's min-h-0 chain and collapses the textarea wrapper to about
  // 30px, cropping the floating Send column from the top. The floor belongs
  // on that wrapper - the 90px textarea/button column of AGENTS.md's composer
  // contract - so attachments or banners stacked above it cannot eat it.
  test("floors the textarea and Send column itself", () => {
    const floor = Number(rule("data-composer-input").match(/min-height:\s*(\d+)px/)?.[1] ?? 0);
    expect(floor).toBeGreaterThanOrEqual(90);
  });

  test("lets the composer root size to its contents instead of a fixed total", () => {
    const root = rule("data-composer-root");
    expect(root).toMatch(/flex-shrink:\s*1/);
    expect(root).not.toMatch(/min-height:\s*\d+px/);
    expect(root).not.toMatch(/min-height:\s*0\b/);
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
