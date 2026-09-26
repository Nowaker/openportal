import { describe, expect, test } from "bun:test";

import { agentBarColor } from "./tui-theme";

const first = "var(--oc-secondary, var(--oc-secondary))";

describe("agentBarColor", () => {
  const agents = [
    { name: "build" },
    { name: "hidden-helper", hidden: true },
    { name: "plan" },
    { name: "Sisyphus - ultraworker", color: "#00CED1" },
    { name: "Themed", color: "warning" },
    { name: "quiet" },
  ];

  test("uses an agent's own hex color", () => {
    expect(agentBarColor("Sisyphus - ultraworker", agents)).toBe("#00CED1");
  });

  test("maps a theme color name to its variable", () => {
    expect(agentBarColor("Themed", agents)).toBe("var(--oc-warning, var(--oc-secondary))");
  });

  test("gives an uncolored agent the color for its position among visible agents", () => {
    expect(agentBarColor("build", agents)).toBe(first);
    expect(agentBarColor("plan", agents)).toBe("var(--oc-accent, var(--oc-secondary))");
    expect(agentBarColor("quiet", agents)).toBe("var(--oc-primary, var(--oc-secondary))");
  });

  test("falls back to the first color for an unknown agent", () => {
    expect(agentBarColor("nobody", agents)).toBe(first);
    expect(agentBarColor(undefined, agents)).toBe(first);
  });

  test("uses the first color for everyone when the list has no colors", () => {
    const colorless = [{ name: "build" }, { name: "plan" }, { name: "Sisyphus - ultraworker" }];
    expect(agentBarColor("plan", colorless)).toBe(first);
    expect(agentBarColor("Sisyphus - ultraworker", colorless)).toBe(first);
  });

  test("tolerates a missing or malformed list", () => {
    expect(agentBarColor("build", undefined)).toBe(first);
    expect(agentBarColor("build", { not: "a list" })).toBe(first);
  });
});
