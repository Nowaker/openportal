import { describe, expect, test } from "bun:test";
import { isTabPartiallyVisible } from "./tabs";

describe("isTabPartiallyVisible", () => {
  test("detects a tab clipped by the leading edge", () => {
    expect(
      isTabPartiallyVisible({
        viewportLeft: 0,
        viewportRight: 100,
        tabLeft: -20,
        tabRight: 40,
      }),
    ).toBe(true);
  });

  test("detects a tab clipped by the trailing edge", () => {
    expect(
      isTabPartiallyVisible({
        viewportLeft: 0,
        viewportRight: 100,
        tabLeft: 70,
        tabRight: 130,
      }),
    ).toBe(true);
  });

  test("keeps fully visible and fully outside tabs unchanged", () => {
    expect(
      isTabPartiallyVisible({
        viewportLeft: 0,
        viewportRight: 100,
        tabLeft: 20,
        tabRight: 80,
      }),
    ).toBe(false);
    expect(
      isTabPartiallyVisible({
        viewportLeft: 0,
        viewportRight: 100,
        tabLeft: 110,
        tabRight: 170,
      }),
    ).toBe(false);
  });

  test("accepts exact boundaries and subpixel rounding", () => {
    expect(
      isTabPartiallyVisible({
        viewportLeft: 0,
        viewportRight: 100,
        tabLeft: 0,
        tabRight: 100,
      }),
    ).toBe(false);
    expect(
      isTabPartiallyVisible({
        viewportLeft: 0,
        viewportRight: 100,
        tabLeft: -0.5,
        tabRight: 100.5,
      }),
    ).toBe(false);
  });
});
