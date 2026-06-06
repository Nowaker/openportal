import { afterEach, expect, test } from "bun:test";

import {
  applyOpencodeEvent,
  applyStuckVerdict,
  clearForTesting,
  getSnapshot,
  isStuckScanningEnabled,
  setStuckScanningEnabled,
} from "./indicator-state";

afterEach(() => {
  clearForTesting();
});

test("permission.asked uses the current opencode properties.id shape", () => {
  applyOpencodeEvent("srv-test", 4096, {
    type: "permission.asked",
    properties: { sessionID: "ses-test", id: "perm-direct" },
  });

  expect(
    getSnapshot({ serverId: "srv-test", sessionId: "ses-test" })[0]
      ?.pendingPermissionIds,
  ).toEqual(["perm-direct"]);
});

test("permission.replied removes the current opencode properties.id shape", () => {
  applyOpencodeEvent("srv-test", 4096, {
    type: "permission.asked",
    properties: { sessionID: "ses-test", id: "perm-direct" },
  });
  applyOpencodeEvent("srv-test", 4096, {
    type: "permission.replied",
    properties: { sessionID: "ses-test", id: "perm-direct" },
  });

  expect(
    getSnapshot({ serverId: "srv-test", sessionId: "ses-test" })[0]
      ?.pendingPermissionIds,
  ).toEqual([]);
});

test("permission events still accept the legacy properties.info.id shape", () => {
  applyOpencodeEvent("srv-test", 4096, {
    type: "permission.asked",
    properties: { sessionID: "ses-test", info: { id: "perm-legacy" } },
  });

  expect(
    getSnapshot({ serverId: "srv-test", sessionId: "ses-test" })[0]
      ?.pendingPermissionIds,
  ).toEqual(["perm-legacy"]);
});

test("disabling scanning clears cached stuck verdicts", () => {
  applyStuckVerdict({
    sessionID: "ses-stuck",
    verdict: "stuck",
    stuck_cause: "no-runner",
    seedTargets: [{ serverId: "srv-test", port: 4096 }],
  });
  expect(
    getSnapshot({ serverId: "srv-test", sessionId: "ses-stuck" })[0]
      ?.stuck_verdict,
  ).toBe("stuck");

  setStuckScanningEnabled(false);

  const s = getSnapshot({ serverId: "srv-test", sessionId: "ses-stuck" })[0];
  expect(s?.stuck_verdict).toBeNull();
  expect(s?.stuck_cause).toBeNull();
  expect(s?.stuck_warnings).toEqual([]);
  expect(s?.retry).toBeNull();
});

test("applyStuckVerdict is a no-op while scanning is disabled", () => {
  setStuckScanningEnabled(false);
  applyStuckVerdict({
    sessionID: "ses-stuck",
    verdict: "stuck",
    stuck_cause: "no-runner",
    seedTargets: [{ serverId: "srv-test", port: 4096 }],
  });
  expect(getSnapshot({ serverId: "srv-test", sessionId: "ses-stuck" })).toEqual(
    [],
  );
  expect(isStuckScanningEnabled()).toBe(false);
});

test("re-enabling scanning lets verdicts apply again", () => {
  setStuckScanningEnabled(false);
  setStuckScanningEnabled(true);
  applyStuckVerdict({
    sessionID: "ses-stuck",
    verdict: "stuck",
    stuck_cause: "stale-stream",
    seedTargets: [{ serverId: "srv-test", port: 4096 }],
  });
  expect(
    getSnapshot({ serverId: "srv-test", sessionId: "ses-stuck" })[0]
      ?.stuck_verdict,
  ).toBe("stuck");
  expect(isStuckScanningEnabled()).toBe(true);
});
