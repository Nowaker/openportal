import { describe, expect, test } from "bun:test";

import {
  archivedRowIsCurrent,
  shouldAutoExpandArchivedSection,
} from "@/lib/sidebar-archive-visibility";

describe("shouldAutoExpandArchivedSection", () => {
  test("returns false when project is collapsed", () => {
    expect(
      shouldAutoExpandArchivedSection(false, "ses_1", [{ id: "ses_1" }] as any),
    ).toBe(false);
  });

  test("returns false when no current session is selected", () => {
    expect(
      shouldAutoExpandArchivedSection(true, undefined, [{ id: "ses_1" }] as any),
    ).toBe(false);
  });

  test("returns true when current session is archived", () => {
    expect(
      shouldAutoExpandArchivedSection(
        true,
        "ses_archived",
        [{ id: "ses_archived" }, { id: "ses_other" }] as any,
      ),
    ).toBe(true);
  });

  test("returns false when current session is not archived", () => {
    expect(
      shouldAutoExpandArchivedSection(
        true,
        "ses_active",
        [{ id: "ses_archived" }] as any,
      ),
    ).toBe(false);
  });
});

describe("archivedRowIsCurrent", () => {
  test("returns true only for the selected archived row", () => {
    expect(archivedRowIsCurrent("ses_1", "ses_1")).toBe(true);
    expect(archivedRowIsCurrent("ses_1", "ses_2")).toBe(false);
    expect(archivedRowIsCurrent("ses_1", undefined)).toBe(false);
  });
});
