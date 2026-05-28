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

interface MockEventSource {
  url: string;
  closed: boolean;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  close: () => void;
}

interface MockIntervalHandle {
  id: number;
  fn: () => void;
  delay: number;
}

interface TestHarness {
  instances: MockEventSource[];
  intervals: Map<number, MockIntervalHandle>;
  now: number;
  restore: () => void;
}

function installHarness(): TestHarness {
  const globals = globalThis as {
    window?: unknown;
    EventSource?: unknown;
  };
  const originalWindow = globals.window;
  const originalEventSource = globals.EventSource;
  const originalDateNow = Date.now;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  const instances: MockEventSource[] = [];
  const intervals = new Map<number, MockIntervalHandle>();
  const harness: TestHarness = {
    instances,
    intervals,
    now: 1_000_000,
    restore: () => {
      Date.now = originalDateNow;
      (globalThis as { setInterval: typeof setInterval }).setInterval =
        originalSetInterval;
      (globalThis as { clearInterval: typeof clearInterval }).clearInterval =
        originalClearInterval;
      globals.window = originalWindow;
      globals.EventSource = originalEventSource;
    },
  };

  Date.now = () => harness.now;

  let nextIntervalId = 1;
  const mockSetInterval = ((fn: () => void, delay: number) => {
    const id = nextIntervalId++;
    intervals.set(id, { id, fn, delay });
    return id;
  }) as typeof setInterval;
  const mockClearInterval = ((id: number) => {
    intervals.delete(id);
  }) as typeof clearInterval;

  globals.window = { setInterval: mockSetInterval };
  (globalThis as { setInterval: unknown }).setInterval = mockSetInterval;
  (globalThis as { clearInterval: unknown }).clearInterval = mockClearInterval;

  function MockEventSourceCtor(this: MockEventSource, url: string): void {
    this.url = url;
    this.closed = false;
    this.onmessage = null;
    this.onerror = null;
    this.close = () => {
      this.closed = true;
    };
    instances.push(this);
  }
  globals.EventSource = MockEventSourceCtor as unknown;

  return harness;
}

describe("createWatchedEventSource: silence-detection + reconnect", () => {
  test("reconnects after silence > silenceTimeoutMs, fires onReconnect, closes old socket", () => {
    const harness = installHarness();
    try {
      let onMessageCalls = 0;
      let onReconnectCalls = 0;

      const handle = createWatchedEventSource({
        url: "/api/test",
        silenceTimeoutMs: 5_000,
        checkIntervalMs: 1_000,
        onMessage: () => {
          onMessageCalls++;
        },
        onReconnect: () => {
          onReconnectCalls++;
        },
      });

      expect(harness.instances.length).toBe(1);
      expect(harness.instances[0]!.url).toBe("/api/test");
      expect(harness.instances[0]!.closed).toBe(false);
      expect(harness.intervals.size).toBe(1);

      const checkHandle = Array.from(harness.intervals.values())[0]!;
      expect(checkHandle.delay).toBe(1_000);

      harness.now += 3_000;
      checkHandle.fn();
      expect(harness.instances.length).toBe(1);
      expect(onReconnectCalls).toBe(0);

      harness.now += 3_000;
      checkHandle.fn();

      expect(harness.instances[0]!.closed).toBe(true);
      expect(harness.instances.length).toBe(2);
      expect(harness.instances[1]!.url).toBe("/api/test");
      expect(harness.instances[1]!.closed).toBe(false);
      expect(onReconnectCalls).toBe(1);
      expect(onMessageCalls).toBe(0);

      harness.now += 2_000;
      checkHandle.fn();
      expect(harness.instances.length).toBe(2);
      expect(onReconnectCalls).toBe(1);

      handle.close();
      expect(harness.instances[1]!.closed).toBe(true);
      expect(harness.intervals.size).toBe(0);

      expect(() => handle.close()).not.toThrow();
    } finally {
      harness.restore();
    }
  });

  test("messages reset the silence timer", () => {
    const harness = installHarness();
    try {
      let reconnectCalls = 0;
      const handle = createWatchedEventSource({
        url: "/api/test",
        silenceTimeoutMs: 5_000,
        checkIntervalMs: 1_000,
        onMessage: () => {},
        onReconnect: () => {
          reconnectCalls++;
        },
      });

      const checkHandle = Array.from(harness.intervals.values())[0]!;
      harness.now += 4_000;
      checkHandle.fn();
      expect(reconnectCalls).toBe(0);

      harness.instances[0]!.onmessage?.({
        data: '{"type":"heartbeat","t":1}',
      } as MessageEvent);

      harness.now += 4_000;
      checkHandle.fn();
      expect(reconnectCalls).toBe(0);
      expect(harness.instances.length).toBe(1);

      harness.now += 6_000;
      checkHandle.fn();
      expect(reconnectCalls).toBe(1);
      expect(harness.instances.length).toBe(2);

      handle.close();
    } finally {
      harness.restore();
    }
  });

  test("close() during a reconnect cycle stops further watchdog ticks", () => {
    const harness = installHarness();
    try {
      const handle = createWatchedEventSource({
        url: "/api/test",
        silenceTimeoutMs: 5_000,
        checkIntervalMs: 1_000,
        onMessage: () => {},
        onReconnect: () => {},
      });

      const checkHandle = Array.from(harness.intervals.values())[0]!;
      handle.close();
      expect(harness.instances[0]!.closed).toBe(true);
      expect(harness.intervals.size).toBe(0);

      harness.now += 100_000;
      checkHandle.fn();
      expect(harness.instances.length).toBe(1);
    } finally {
      harness.restore();
    }
  });
});
