import { describe, expect, test } from "bun:test";
import {
  PROMPT_TEMPLATE_PREAMBLE,
  buildPromptFromSelection,
  buildPromptWithTemplates,
  insertSlashTemplate,
  parsePromptWithTemplates,
} from "./prompt-template-format";

describe("buildPromptFromSelection", () => {
  test("uses the latest selection, order, and one-time edits", () => {
    const templates = [
      { id: "pull", name: "Pull", body: "pull body" },
      { id: "push", name: "Push", body: "push body" },
    ];

    expect(
      buildPromptFromSelection(
        "ship it",
        [...templates].reverse(),
        new Set(["push", "pull"]),
        { push: "edited push body" },
      ),
    ).toBe(
      buildPromptWithTemplates("ship it", [
        { name: "Push", body: "edited push body", modified: true },
        { name: "Pull", body: "pull body", modified: false },
      ]),
    );
  });
});

describe("buildPromptWithTemplates", () => {
  test("returns plain user text when no templates", () => {
    expect(buildPromptWithTemplates("hello world", [])).toBe("hello world");
  });

  test("appends single template block under separator + preamble", () => {
    const out = buildPromptWithTemplates("do the thing", [
      { name: "Pull", body: "git pull then summarize" },
    ]);
    expect(out).toBe(
      `do the thing\n\n---\n\n${PROMPT_TEMPLATE_PREAMBLE}\n\n# /template "Pull":\n\ngit pull then summarize`,
    );
  });

  test("appends multiple template blocks separated by blank line", () => {
    const out = buildPromptWithTemplates("ship it", [
      { name: "Pull", body: "pull body" },
      { name: "Push", body: "push body" },
    ]);
    expect(out).toBe(
      `ship it\n\n---\n\n${PROMPT_TEMPLATE_PREAMBLE}\n\n# /template "Pull":\n\npull body\n\n# /template "Push":\n\npush body`,
    );
  });

  test("escapes double quotes in template names", () => {
    const out = buildPromptWithTemplates("ok", [
      { name: 'has "quoted" word', body: "body" },
    ]);
    expect(out).toContain('# /template "has \\"quoted\\" word":');
  });

  test("trims user text before formatting", () => {
    expect(buildPromptWithTemplates("  hi  \n\n", [])).toBe("hi");
  });
});

describe("parsePromptWithTemplates", () => {
  test("returns null for plain user text", () => {
    expect(parsePromptWithTemplates("just a prompt")).toBeNull();
  });

  test("returns null when separator and preamble are absent", () => {
    expect(parsePromptWithTemplates("hello\n\n# /template \"X\":\n\nbody")).toBeNull();
  });

  test("round-trips a single-template build", () => {
    const built = buildPromptWithTemplates("hello world", [
      { name: "Pull", body: "git pull then summarize" },
    ]);
    const parsed = parsePromptWithTemplates(built);
    expect(parsed).not.toBeNull();
    expect(parsed!.userText).toBe("hello world");
    expect(parsed!.templates).toEqual([
      { name: "Pull", body: "git pull then summarize", modified: false },
    ]);
  });

  test("round-trips a multi-template build with multiline bodies", () => {
    const built = buildPromptWithTemplates("ship it", [
      { name: "Pull", body: "step 1\nstep 2\n\nstep 3" },
      { name: "Push", body: "step A\nstep B" },
    ]);
    const parsed = parsePromptWithTemplates(built);
    expect(parsed).not.toBeNull();
    expect(parsed!.userText).toBe("ship it");
    expect(parsed!.templates).toEqual([
      { name: "Pull", body: "step 1\nstep 2\n\nstep 3", modified: false },
      { name: "Push", body: "step A\nstep B", modified: false },
    ]);
  });

  test("round-trips a modified block with + modifications suffix", () => {
    const built = buildPromptWithTemplates("ok", [
      { name: "Pull", body: "edited body", modified: true },
    ]);
    expect(built).toContain('# /template "Pull" + modifications:');
    const parsed = parsePromptWithTemplates(built);
    expect(parsed!.templates).toEqual([
      { name: "Pull", body: "edited body", modified: true },
    ]);
  });

  test("mixes modified and unmodified blocks in one prompt", () => {
    const built = buildPromptWithTemplates("ship", [
      { name: "Pull", body: "pull body" },
      { name: "Push", body: "push body edited", modified: true },
    ]);
    const parsed = parsePromptWithTemplates(built);
    expect(parsed!.templates).toEqual([
      { name: "Pull", body: "pull body", modified: false },
      { name: "Push", body: "push body edited", modified: true },
    ]);
  });

  test("round-trips an escaped-quote template name", () => {
    const built = buildPromptWithTemplates("ok", [
      { name: 'has "quoted" word', body: "body" },
    ]);
    const parsed = parsePromptWithTemplates(built);
    expect(parsed!.templates[0].name).toBe('has "quoted" word');
  });

  test("preserves blank lines inside user prompt", () => {
    const built = buildPromptWithTemplates("first line\n\nsecond para", [
      { name: "X", body: "y" },
    ]);
    const parsed = parsePromptWithTemplates(built);
    expect(parsed!.userText).toBe("first line\n\nsecond para");
  });
});

describe("insertSlashTemplate", () => {
  test("inlining an empty composer matches the checkbox build", () => {
    const token = "/template Pull";
    const { newValue, cursorPos } = insertSlashTemplate(
      token,
      0,
      token.length,
      { name: "Pull", body: "git pull then summarize" },
    );
    expect(newValue).toBe(
      buildPromptWithTemplates("", [
        { name: "Pull", body: "git pull then summarize" },
      ]),
    );
    expect(cursorPos).toBe(0);
  });

  test("keeps trailing user text as the prompt body", () => {
    const value = "/template Pull\nship it";
    const { newValue, cursorPos } = insertSlashTemplate(
      value,
      0,
      "/template Pull".length,
      { name: "Pull", body: "pull body" },
    );
    expect(newValue).toBe(
      buildPromptWithTemplates("ship it", [{ name: "Pull", body: "pull body" }]),
    );
    expect(cursorPos).toBe("ship it".length);
  });

  test("accumulates a second template under one preamble, like two checkboxes", () => {
    const first = insertSlashTemplate("/template Pull", 0, "/template Pull".length, {
      name: "Pull",
      body: "pull body",
    }).newValue;
    const second = insertSlashTemplate(`/${first}`, 0, 1, {
      name: "Push",
      body: "push body",
    }).newValue;
    expect(second).toBe(
      buildPromptWithTemplates("", [
        { name: "Pull", body: "pull body" },
        { name: "Push", body: "push body" },
      ]),
    );
  });

  test("re-selecting the same template replaces its body without duplicating", () => {
    const first = insertSlashTemplate("/template Pull", 0, "/template Pull".length, {
      name: "Pull",
      body: "v1",
    }).newValue;
    const again = insertSlashTemplate(`/${first}`, 0, 1, {
      name: "Pull",
      body: "v2",
    }).newValue;
    expect(again).toBe(
      buildPromptWithTemplates("", [{ name: "Pull", body: "v2" }]),
    );
  });
});
