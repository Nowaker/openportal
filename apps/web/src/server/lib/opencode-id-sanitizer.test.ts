import { describe, expect, test } from "bun:test";

import {
  STRIPPED_ID_FIELDS,
  stripCallerSuppliedIds,
} from "./opencode-id-sanitizer";

describe("stripCallerSuppliedIds", () => {
  test("removes messageID, sessionID, partID from a payload", () => {
    const input = {
      parts: [{ type: "text", text: "hello" }],
      model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
      messageID: "msg_f1234",
      sessionID: "ses_abc",
      partID: "prt_xyz",
    };
    const out = stripCallerSuppliedIds(input);
    expect(out).toEqual({
      parts: [{ type: "text", text: "hello" }],
      model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
    });
  });

  test("does not mutate the input object", () => {
    const input = {
      parts: [],
      messageID: "msg_f1234",
    };
    stripCallerSuppliedIds(input);
    expect(input.messageID).toBe("msg_f1234");
  });

  test("is a no-op for payloads without any banned fields", () => {
    const input = {
      parts: [{ type: "text", text: "no ids here" }],
      agent: "build",
    };
    expect(stripCallerSuppliedIds(input)).toEqual(input);
  });

  test("returns null/undefined unchanged", () => {
    expect(stripCallerSuppliedIds(null)).toBeNull();
    expect(stripCallerSuppliedIds(undefined)).toBeUndefined();
  });

  test("exposes the canonical list of stripped fields", () => {
    expect(STRIPPED_ID_FIELDS).toEqual(["messageID", "sessionID", "partID"]);
  });
});

describe("prompt dispatch routes (source-level guarantee)", () => {
  // These tests grep the route source files to fail-loud if someone
  // re-introduces `messageID:` into the outbound prompt_async/command
  // payload. They complement AGENTS.md "Never pre-generate
  // opencode-assigned IDs" and are intentionally NOT mocked - they
  // assert the literal source text.
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");

  const routeRoot = path.resolve(
    __dirname,
    "../opencode/[port]/session/[id]",
  );

  test("prompt.ts payload does not include messageID", () => {
    const src = fs.readFileSync(path.join(routeRoot, "prompt.ts"), "utf8");
    // Permit references inside comments / banner text but the payload
    // assembly itself must not name `messageID`.
    const payloadStart = src.indexOf("const payload");
    const payloadEnd = src.indexOf("};", payloadStart);
    const payloadBlock = src.slice(payloadStart, payloadEnd);
    expect(payloadBlock.includes("messageID")).toBe(false);
  });

  test("command.ts session.command call does not pass messageID", () => {
    const src = fs.readFileSync(path.join(routeRoot, "command.ts"), "utf8");
    const callStart = src.indexOf("client.session.command(");
    const callEnd = src.indexOf("});", callStart);
    const callBlock = src.slice(callStart, callEnd);
    expect(callBlock.includes("messageID")).toBe(false);
  });

  test("prompt.ts does not generate msg_ ID strings", () => {
    const src = fs.readFileSync(path.join(routeRoot, "prompt.ts"), "utf8");
    // The forensic doc reference / AGENTS.md reference may contain
    // `msg_` in comments; only fail on assignment-shaped code patterns.
    expect(src.includes("`msg_${")).toBe(false);
    expect(src.includes("`msg_f${")).toBe(false);
  });

  test("command.ts does not generate msg_ ID strings", () => {
    const src = fs.readFileSync(path.join(routeRoot, "command.ts"), "utf8");
    expect(src.includes("`msg_${")).toBe(false);
    expect(src.includes("`msg_f${")).toBe(false);
  });
});
