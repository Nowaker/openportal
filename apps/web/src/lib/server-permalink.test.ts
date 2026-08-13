import { describe, expect, test } from "bun:test";

import {
  buildRestoreTarget,
  buildServerFallbackTarget,
  isRestorablePath,
} from "@/lib/server-permalink";

describe("isRestorablePath", () => {
  test("accepts an in-app absolute path", () => {
    expect(isRestorablePath("/session/ses_abc")).toBe(true);
  });

  test("rejects a protocol-relative path (different origin)", () => {
    expect(isRestorablePath("//evil.example/session")).toBe(false);
  });

  test("rejects the backslash variant of a protocol-relative path", () => {
    expect(isRestorablePath("/\\evil.example/session")).toBe(false);
  });

  test("rejects an absolute URL", () => {
    expect(isRestorablePath("https://evil.example/session")).toBe(false);
  });

  test("rejects a relative path and non-strings", () => {
    expect(isRestorablePath("session/ses_abc")).toBe(false);
    expect(isRestorablePath(undefined)).toBe(false);
    expect(isRestorablePath(42)).toBe(false);
  });
});

describe("buildServerFallbackTarget", () => {
  test("keeps every search param and the hash, and records the pathname", () => {
    const target = buildServerFallbackTarget(
      {
        pathname: "/session/ses_abc",
        search: { server: "srv_dead", scope: "all" },
        hash: "msg-msg_xyz",
      },
      "unreachable",
    );
    expect(target.to).toBe("/servers");
    expect(target.search).toEqual({
      server: "srv_dead",
      scope: "all",
      from: "/session/ses_abc",
      serverFallback: "unreachable",
    });
    expect(target.hash).toBe("msg-msg_xyz");
  });

  test("carries the unknown reason", () => {
    const target = buildServerFallbackTarget(
      { pathname: "/", search: { server: "srv_ghost" }, hash: "" },
      "unknown",
    );
    expect(target.search.serverFallback).toBe("unknown");
    expect(target.search.from).toBe("/");
  });

  test("does not stack `from` when bouncing a second time", () => {
    const target = buildServerFallbackTarget(
      {
        pathname: "/prompts",
        search: { server: "srv_dead", from: "/session/ses_old" },
        hash: "",
      },
      "unreachable",
    );
    expect(target.search.from).toBe("/prompts");
  });

  test("does not mutate the caller's search object", () => {
    const search = { server: "srv_dead" };
    buildServerFallbackTarget(
      { pathname: "/session/ses_abc", search, hash: "" },
      "unknown",
    );
    expect(search).toEqual({ server: "srv_dead" });
  });
});

describe("buildRestoreTarget", () => {
  test("rebuilds the original destination on the opened server", () => {
    const restored = buildRestoreTarget(
      {
        pathname: "/servers",
        search: {
          server: "srv_dead",
          scope: "all",
          from: "/session/ses_abc",
          serverFallback: "unreachable",
        },
        hash: "msg-msg_xyz",
      },
      "srv_live",
    );
    expect(restored).toEqual({
      to: "/session/ses_abc",
      search: { server: "srv_live", scope: "all" },
      hash: "msg-msg_xyz",
    });
  });

  test("restores to any server the user picks, not just the requested one", () => {
    const restored = buildRestoreTarget(
      {
        pathname: "/servers",
        search: { server: "srv_dead", from: "/session/ses_abc" },
        hash: "",
      },
      "srv_other",
    );
    expect(restored?.search.server).toBe("srv_other");
  });

  test("returns null without a `from` - a plain visit to /servers", () => {
    expect(
      buildRestoreTarget(
        { pathname: "/servers", search: {}, hash: "" },
        "srv_live",
      ),
    ).toBeNull();
  });

  test("returns null for an off-origin `from`", () => {
    expect(
      buildRestoreTarget(
        {
          pathname: "/servers",
          search: { from: "//evil.example/session" },
          hash: "",
        },
        "srv_live",
      ),
    ).toBeNull();
  });

  test("round-trips a fallback target back to where it came from", () => {
    const original = {
      pathname: "/session/ses_abc",
      search: { server: "srv_dead", scope: "all" },
      hash: "msg-msg_xyz",
    };
    const fallback = buildServerFallbackTarget(original, "unknown");
    const restored = buildRestoreTarget(
      { pathname: fallback.to, search: fallback.search, hash: fallback.hash },
      "srv_dead",
    );
    expect(restored).toEqual({
      to: original.pathname,
      search: original.search,
      hash: original.hash,
    });
  });
});
