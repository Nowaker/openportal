import { expect, test } from "bun:test";
import { patchSessionRow } from "./session-row-patch";

test("merges the frame's row over the cached one, keeping cached-only fields", () => {
  const rows = [{ id: "ses_a", title: "old", _pendingTitle: "x" }, { id: "ses_b", title: "b" }];

  const patched = patchSessionRow(rows, { id: "ses_a", title: "new" });

  expect(patched).toEqual([{ id: "ses_a", title: "new", _pendingTitle: "x" }, { id: "ses_b", title: "b" }]);
  expect(rows[0]?.title).toBe("old");
});

test("returns null for a row the list does not have, or a frame with no id", () => {
  expect(patchSessionRow([{ id: "ses_b" }], { id: "ses_a" })).toBeNull();
  expect(patchSessionRow([{ id: "ses_b" }], { title: "t" })).toBeNull();
  expect(patchSessionRow([{ id: "ses_b" }], undefined)).toBeNull();
});
