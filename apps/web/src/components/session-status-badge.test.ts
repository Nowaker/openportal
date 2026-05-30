import { describe, expect, test } from "bun:test";

import { pickBadgeStatus as pickBadge, STATUS_VISUALS } from "@/lib/session-status";
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
    stuck_verdict: null,
    stuck_cause: null,
    stuck_warnings: [],
    retry: null,
    opencode_retry: null,
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

  test("STUCK wins over QUESTION+PERMISSION+COMPACTING+TOOL+THINKING", () => {
    const badge = pickBadge(
      makeState({
        stuck_verdict: "stuck",
        stuck_cause: "no-runner",
        pendingQuestionIds: ["q1"],
        pendingPermissionIds: ["p1"],
        mode: "compaction",
        currentToolName: "Bash",
        busy: true,
      }),
    );
    expect(badge?.kind).toBe("stuck");
    expect(badge?.title).toContain("no-runner");
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

  test("COMPACTING renders for mode='compaction' with fuchsia color", () => {
    const badge = pickBadge(
      makeState({ mode: "compaction", busy: true, idle: false }),
    );
    expect(badge?.kind).toBe("compacting");
    expect(badge?.label).toBe("COMPACTING");
    // Compacting moved from violet-500 to fuchsia-500 (visual distinction
    // from subagent-busy, which kept violet).
    expect(STATUS_VISUALS.compacting.bg).toBe("bg-fuchsia-500");
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

  test("RETRY surfaces opencode-native retry with attempt in label", () => {
    const badge = pickBadge(
      makeState({
        busy: true,
        idle: false,
        opencode_retry: {
          attempt: 3,
          next: Date.now() + 28_000,
          message: "rate limited",
        },
      }),
    );
    expect(badge?.kind).toBe("retry");
    expect(badge?.label).toBe("RETRY 3");
    expect(badge?.title).toContain("Attempt 3");
    expect(badge?.title).toContain("rate limited");
    expect(badge?.title).toContain("Next attempt in");
  });

  test("RETRY wins over TOOL+THINKING (busy+tool+retry)", () => {
    const badge = pickBadge(
      makeState({
        busy: true,
        idle: false,
        currentToolName: "Read",
        opencode_retry: {
          attempt: 1,
          next: Date.now() + 5_000,
          message: "transient error",
        },
      }),
    );
    expect(badge?.kind).toBe("retry");
  });

  test("COMPACTING wins over RETRY (priority chain)", () => {
    const badge = pickBadge(
      makeState({
        mode: "compaction",
        busy: true,
        idle: false,
        opencode_retry: {
          attempt: 2,
          next: Date.now() + 5_000,
          message: "x",
        },
      }),
    );
    expect(badge?.kind).toBe("compacting");
  });

  test("QUEUED when pendingPromptIds non-empty and otherwise idle", () => {
    const badge = pickBadge(
      makeState({ pendingPromptIds: ["pp1"] }),
    );
    expect(badge?.kind).toBe("queued");
    expect(badge?.label).toBe("QUEUED");
  });
});

describe("STATUS_VISUALS color invariants", () => {
  test("review-needed is GREEN (was violet pre-refactor)", () => {
    expect(STATUS_VISUALS["review-needed"].bg).toBe("bg-emerald-500");
    expect(STATUS_VISUALS["review-needed"].pulse).toBe(false);
  });

  test("compacting and subagent-busy do NOT share the same color", () => {
    expect(STATUS_VISUALS.compacting.bg).not.toBe(
      STATUS_VISUALS["subagent-busy"].bg,
    );
  });

  test("retry is distinct from busy amber", () => {
    expect(STATUS_VISUALS.retry.bg).toBe("bg-orange-600");
    expect(STATUS_VISUALS.tool.bg).toBe("bg-amber-500");
    expect(STATUS_VISUALS.retry.bg).not.toBe(STATUS_VISUALS.tool.bg);
  });

  test("error is red and not pulsing; stuck is red and pulsing", () => {
    expect(STATUS_VISUALS.error.bg).toBe("bg-red-500");
    expect(STATUS_VISUALS.error.pulse).toBe(false);
    expect(STATUS_VISUALS.stuck.bg).toBe("bg-red-500");
    expect(STATUS_VISUALS.stuck.pulse).toBe(true);
  });

  test("question and permission share the sky family on purpose", () => {
    expect(STATUS_VISUALS.question.bg).toBe("bg-sky-500");
    expect(STATUS_VISUALS.permission.bg).toBe("bg-sky-500");
  });
});
