import { afterEach, expect, test } from "bun:test";

import {
  applyOpencodeEvent,
  clearForTesting,
  getSnapshot,
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
