import { describe, expect, test } from "bun:test";
import { homedir } from "os";

import {
  evaluateEffect,
  expandHomePattern,
  toRules,
  wildcardMatch,
} from "./opencode-permissions";

describe("wildcardMatch", () => {
  test("'*' matches any run of characters including slashes", () => {
    expect(wildcardMatch("anything/at/all", "*")).toBe(true);
    expect(wildcardMatch("a/b/c.env", "*.env")).toBe(true);
    expect(wildcardMatch("foo.txt", "*.env")).toBe(false);
  });

  test("'?' matches exactly one character", () => {
    expect(wildcardMatch("abc", "a?c")).toBe(true);
    expect(wildcardMatch("ac", "a?c")).toBe(false);
  });

  test("bare patterns match literally (no implicit wildcard)", () => {
    expect(wildcardMatch(".npmrc", ".npmrc")).toBe(true);
    expect(wildcardMatch("x.npmrc", ".npmrc")).toBe(false);
  });

  test("'**' behaves like '*' (matches across path separators)", () => {
    expect(wildcardMatch("/etc/shadow", "/etc/**")).toBe(true);
    expect(wildcardMatch("/home/u/.ssh/id_rsa", "/home/u/.ssh/*")).toBe(true);
  });
});

describe("toRules", () => {
  test("bare effect string becomes a single '*' rule", () => {
    expect(toRules("allow")).toEqual([{ resource: "*", effect: "allow" }]);
  });

  test("object becomes one rule per entry, preserving key order", () => {
    expect(toRules({ "*": "allow", "*.env": "deny" })).toEqual([
      { resource: "*", effect: "allow" },
      { resource: "*.env", effect: "deny" },
    ]);
  });

  test("entries with non-effect values are dropped", () => {
    expect(toRules({ "*": "allow", bogus: "maybe", "*.key": "deny" })).toEqual([
      { resource: "*", effect: "allow" },
      { resource: "*.key", effect: "deny" },
    ]);
  });

  test("non-object, non-effect input yields no rules", () => {
    expect(toRules(undefined)).toEqual([]);
    expect(toRules(42)).toEqual([]);
    expect(toRules(null)).toEqual([]);
  });
});

describe("evaluateEffect", () => {
  const rules = toRules({ "*": "allow", "*.env": "deny", "*.env.example": "allow" });

  test("last matching rule wins", () => {
    expect(evaluateEffect("config.env", rules, "allow")).toBe("deny");
    expect(evaluateEffect("config.env.example", rules, "allow")).toBe("allow");
  });

  test("falls back to the default when nothing matches", () => {
    expect(evaluateEffect("README.md", toRules({ "*.secret": "deny" }), "allow")).toBe(
      "allow",
    );
    expect(evaluateEffect("README.md", [], "ask")).toBe("ask");
  });

  test("plain catch-all allow passes", () => {
    expect(evaluateEffect("opencode.jsonc", rules, "allow")).toBe("allow");
  });
});

describe("expandHomePattern", () => {
  const home = homedir();

  test("expands leading ~ and $HOME", () => {
    expect(expandHomePattern("~")).toBe(home);
    expect(expandHomePattern("$HOME")).toBe(home);
    expect(expandHomePattern("~/.ssh/*")).toBe(`${home}/.ssh/*`);
    expect(expandHomePattern("$HOME/.cache/**")).toBe(`${home}/.cache/**`);
  });

  test("leaves absolute and non-home patterns untouched", () => {
    expect(expandHomePattern("/tmp/**")).toBe("/tmp/**");
    expect(expandHomePattern("*.env")).toBe("*.env");
  });
});
