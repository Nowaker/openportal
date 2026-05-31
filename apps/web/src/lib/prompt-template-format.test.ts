import { describe, expect, test } from "bun:test";
import {
  PROMPT_TEMPLATE_PREAMBLE,
  buildPromptWithTemplates,
  parsePromptWithTemplates,
} from "./prompt-template-format";

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
      { name: "Pull", body: "git pull then summarize" },
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
      { name: "Pull", body: "step 1\nstep 2\n\nstep 3" },
      { name: "Push", body: "step A\nstep B" },
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
