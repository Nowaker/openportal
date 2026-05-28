import { describe, expect, test } from "bun:test";

import { createWatchedEventSource } from "./sse-watchdog";

describe("createWatchedEventSource: SSR safety", () => {
  test("returns a no-op handle when window is undefined (server-side render path)", () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    try {
      const handle = createWatchedEventSource({
        url: "/api/whatever",
        silenceTimeoutMs: 60_000,
        onMessage: () => {
          throw new Error("onMessage must not be called in SSR mode");
        },
      });
      expect(typeof handle.close).toBe("function");
      expect(() => handle.close()).not.toThrow();
    } finally {
      if (originalWindow !== undefined) {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
    }
  });

  test("close() on the SSR no-op handle is idempotent", () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    try {
      const handle = createWatchedEventSource({
        url: "/api/whatever",
        silenceTimeoutMs: 60_000,
        onMessage: () => {},
      });
      handle.close();
      expect(() => handle.close()).not.toThrow();
      expect(() => handle.close()).not.toThrow();
    } finally {
      if (originalWindow !== undefined) {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
    }
  });
});
