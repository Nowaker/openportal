import { describe, expect, test } from "bun:test";
import { withServerSearch } from "./route-search";

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
