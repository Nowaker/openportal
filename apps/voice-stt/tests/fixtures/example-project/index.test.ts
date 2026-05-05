import { describe, expect, it } from "bun:test";
import { greet } from "./index";

describe("greet", () => {
  it("falls back when name is empty", () => {
    expect(greet("")).toBe("Hello!");
  });

  it("interpolates the name", () => {
    expect(greet("World")).toBe("Hello, World!");
  });
});
