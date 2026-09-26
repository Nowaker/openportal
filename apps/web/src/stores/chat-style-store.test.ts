import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { useChatStyleStore } from "./chat-style-store";

describe("terminal-style chat opt-in", () => {
  test("defaults to the portal's own look", () => {
    expect(useChatStyleStore.getInitialState().chatStyle).toBe("portal");
  });

  // The default look must stay exactly as it is on every platform, so no
  // rule that draws the terminal style may apply without the opt-in
  // attribute on <html>.
  test("every terminal chat rule is scoped under the opt-in attribute", () => {
    const css = readFileSync(join(import.meta.dir, "../main.css"), "utf8");
    const unscoped = css
      .split("\n")
      .filter((line) => /(^|[\s,])\.chat-(prose|user)/.test(line))
      .filter((line) => !line.startsWith('html[data-chat-style="terminal"] '));
    expect(unscoped).toEqual([]);
  });
});
