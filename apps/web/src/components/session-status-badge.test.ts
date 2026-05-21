import { describe, expect, test } from "bun:test";

import { pickBadge } from "./session-status-badge";
import type { SessionIndicatorState } from "@/hooks/use-indicators";

function makeState(overrides: Partial<SessionIndicatorState> = {}): SessionIndicatorState {
  return {
    serverId: "srv-test",
    port: 4096,
    sessionId: "ses_test",
    busy: false,
    idle: true,
    lastEventAt: Date.now(),
    lastError: null,
    pendingQuestionIds: [],
    pendingPermissionIds: [],
    todoState: null,
    todos: null,
    pendingPromptIds: [],
    connected: true,
    mode: null,
    currentToolName: null,
    inFlightAssistantId: null,
    ...overrides,
  };
}

describe("pickBadge priority chain", () => {
  test("idle session yields no badge", () => {
    expect(pickBadge(makeState())).toBeNull();
  });

  test("null state yields no badge", () => {
    expect(pickBadge(null)).toBeNull();
  });

  test("ERROR wins over everything else", () => {
    const badge = pickBadge(
      makeState({
        lastError: "Compaction failed",
        pendingQuestionIds: ["q1"],
        pendingPermissionIds: ["p1"],
        mode: "compaction",
        currentToolName: "Bash",
        busy: true,
      }),
    );
    expect(badge?.kind).toBe("error");
    expect(badge?.label).toBe("ERROR");
  });

  test("QUESTION wins over PERMISSION+COMPACTING+TOOL+THINKING", () => {
    const badge = pickBadge(
      makeState({
        pendingQuestionIds: ["q1"],
        pendingPermissionIds: ["p1"],
        mode: "compaction",
        currentToolName: "Bash",
        busy: true,
      }),
    );
    expect(badge?.kind).toBe("question");
    expect(badge?.label).toBe("QUESTION");
  });

  test("PERMISSION wins over COMPACTING+TOOL+THINKING", () => {
    const badge = pickBadge(
      makeState({
        pendingPermissionIds: ["p1"],
        mode: "compaction",
        currentToolName: "Bash",
        busy: true,
      }),
    );
    expect(badge?.kind).toBe("permission");
    expect(badge?.label).toBe("PERMISSION");
  });

  test("COMPACTING renders for mode='compaction'", () => {
    const badge = pickBadge(
      makeState({ mode: "compaction", busy: true, idle: false }),
    );
    expect(badge?.kind).toBe("compacting");
    expect(badge?.label).toBe("COMPACTING");
    expect(badge?.className).toContain("violet");
    expect(badge?.title).toContain("summarising");
  });

  test("COMPACTING wins over TOOL+THINKING", () => {
    const badge = pickBadge(
      makeState({
        mode: "compaction",
        currentToolName: "Bash",
        busy: true,
      }),
    );
    expect(badge?.kind).toBe("compacting");
  });

  test("TOOL wins over THINKING when busy", () => {
    const badge = pickBadge(
      makeState({ currentToolName: "Read", busy: true, idle: false }),
    );
    expect(badge?.kind).toBe("tool");
    expect(badge?.label).toBe("TOOL: Read");
  });

  test("THINKING when busy but no tool/mode", () => {
    const badge = pickBadge(
      makeState({ busy: true, idle: false }),
    );
    expect(badge?.kind).toBe("thinking");
    expect(badge?.label).toBe("THINKING");
  });

  test("QUEUED when pendingPromptIds non-empty and otherwise idle", () => {
    const badge = pickBadge(
      makeState({ pendingPromptIds: ["pp1"] }),
    );
    expect(badge?.kind).toBe("queued");
    expect(badge?.label).toBe("QUEUED");
  });
});
