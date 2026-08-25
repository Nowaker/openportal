import { describe, expect, test } from "bun:test";
import {
  sanitizeNewSessionHref,
  sanitizeNewSessionSearch,
  withServerSearch,
} from "./route-search";

describe("withServerSearch", () => {
  test("keeps child-route search state when adding the active server", () => {
    const current = {
      directory: "/workspace",
      autoPrompt: "continue",
    };

    expect(withServerSearch(current, "srv-local")).toEqual({
      directory: "/workspace",
      autoPrompt: "continue",
      server: "srv-local",
    });
  });
});

describe("sanitizeNewSessionHref", () => {
  test("drops inherited route-specific state from new-session links", () => {
    expect(
      sanitizeNewSessionHref(
        "/session/new?server=srv-local&autoPrompt=continue&focus=old&directory=%2Fworkspace",
      ),
    ).toBe("/session/new?server=srv-local&directory=%2Fworkspace");
  });

  test("leaves unrelated destinations unchanged", () => {
    expect(sanitizeNewSessionHref("/prompts?server=srv-local&focus=ses_1")).toBe(
      "/prompts?server=srv-local&focus=ses_1",
    );
  });
});

describe("sanitizeNewSessionSearch", () => {
  test("drops inherited route-specific state from ordinary navigation", () => {
    expect(
      sanitizeNewSessionSearch({
        server: "srv-local",
        directory: "/workspace",
        autoPrompt: "stale prompt",
        focus: "old",
      }),
    ).toEqual({ server: "srv-local", directory: "/workspace" });
  });

  test("keeps an explicitly supplied folder-browser prompt", () => {
    expect(
      sanitizeNewSessionSearch(
        { server: "srv-local", autoPrompt: "stale prompt" },
        { directory: "/next", autoPrompt: "fresh prompt" },
      ),
    ).toEqual({
      server: "srv-local",
      directory: "/next",
      autoPrompt: "fresh prompt",
    });
  });
});
