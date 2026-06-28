import { describe, expect, test } from "bun:test";

import { parseOmoBlocks, userTextFromOmoBlocks } from "./omo-injection";

describe("parseOmoBlocks system-reminder wrappers", () => {
  test("keeps a background task reminder as one collapsed omo block", () => {
    const text = `<system-reminder>
[BACKGROUND TASK RESULT READY]
**ID:** \`bg_6b6a9cf0\`
</system-reminder>
<!-- OMO_INTERNAL_INITIATOR -->`;

    const blocks = parseOmoBlocks(text);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("omo");
    expect(blocks[0]?.summary).toBe("[BACKGROUND TASK RESULT READY]");
  });

  test("keeps nested system-reminder content fully inside one omo block", () => {
    const text = `<system-reminder>
The user sent the following message:
<system-reminder>
[BACKGROUND TASK RESULT READY]
**ID:** \`bg_6b6a9cf0\`
</system-reminder>
<!-- OMO_INTERNAL_INITIATOR -->

Please address this message and continue with your tasks.
</system-reminder>`;

    const blocks = parseOmoBlocks(text);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("omo");
    expect(blocks[0]?.summary).toBe("[BACKGROUND TASK RESULT READY]");
    expect(blocks[0]?.text).toContain(
      "Please address this message and continue with your tasks.",
    );
  });

  test("extracts real user text from the user-message system-reminder boilerplate", () => {
    const userText = "other agent reported: a hash-permalink crash remains.";
    const text = `<system-reminder>
The user sent the following message:
${userText}

Please address this message and continue with your tasks.
</system-reminder>`;

    const blocks = parseOmoBlocks(text);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe("omo");
    expect(blocks[0]?.summary).toBe(
      "Please address this message and continue with your tasks.",
    );
    expect(blocks[0]?.text).not.toContain(userText);
    expect(blocks[1]).toEqual({ kind: "user", text: userText });
  });

  test("does not collapse a system-reminder cited inside a fenced code block", () => {
    const text =
      "when i cite some code, it shouldn't be omo-wrapped:\n\n```\n<system-reminder>\n[BACKGROUND TASK RESULT READY]\nsome content here\n</system-reminder>\n\n```\n\nthat's the citation.";

    const blocks = parseOmoBlocks(text);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("user");
    expect(blocks[0]?.text).toBe(text);
  });

  test("still detects a real system-reminder outside the fenced code block", () => {
    const text =
      "```\n<system-reminder>\ncited example\n</system-reminder>\n```\n\n<system-reminder>\n[BACKGROUND TASK RESULT READY]\nreal one\n</system-reminder>";

    const blocks = parseOmoBlocks(text);

    expect(blocks.some((b) => b.kind === "omo")).toBe(true);
    const omoBlocks = blocks.filter((b) => b.kind === "omo");
    expect(omoBlocks).toHaveLength(1);
    expect(omoBlocks[0]?.summary).toBe("[BACKGROUND TASK RESULT READY]");
  });

  test("ignores orphan reminder tail inside fenced code blocks", () => {
    const text =
      "```\n<system-reminder>\nfoo\n</system-reminder>\n```\n\nnormal user prose continues here.";

    const blocks = parseOmoBlocks(text);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("user");
    expect(blocks[0]?.text).toBe(text);
  });

  test("folds a stale stripped orphan tail back into the omo block", () => {
    const meta = encodeURIComponent(
      JSON.stringify({
        id: "0.0",
        header: "<system-reminder>",
        summary: "[BACKGROUND TASK RESULT READY]",
        bytes: 200,
      }),
    );
    const text = `<!--OMO-STRIPPED:${meta}-->

Please address this message and continue with your tasks.
</system-reminder>`;

    const blocks = parseOmoBlocks(text);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("omo");
    expect(blocks[0]?.summary).toBe("[BACKGROUND TASK RESULT READY]");
  });
});

describe("parseOmoBlocks directory context wrappers", () => {
  test("uses the explicit Directory Context end marker before source and delimiter fallbacks", () => {
    const path = "/workspace/project/AGENTS.md";
    const agents = `# Rules\n\n---\n\nStill AGENTS content.\n`;
    const userText = "actual user request";
    const text = `[Directory Context: ${path}]\n${agents}\n<!-- OMO_DIRECTORY_CONTEXT_END -->\n${userText}`;

    const blocks = parseOmoBlocks(text, {
      directoryContextResolver: () => null,
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe("omo");
    expect(blocks[0]?.header).toBe("[Directory Context]");
    expect(blocks[0]?.summary).toBe(path);
    expect(blocks[0]?.text).toContain("Still AGENTS content.");
    expect(blocks[1]).toEqual({ kind: "user", text: userText });
  });

  test("uses the referenced AGENTS.md contents to find the real delimiter", () => {
    const path = "/workspace/project/AGENTS.md";
    const agents = `# Rules\n\nThis file can contain markdown fences.\n\n---\n\nStill AGENTS content.\n`;
    const userText = "actual user request";
    const text = `[Directory Context: ${path}]\n${agents}\n---\n${userText}`;

    const blocks = parseOmoBlocks(text, {
      directoryContextResolver: (p) => (p === path ? agents : null),
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe("omo");
    expect(blocks[0]?.header).toBe("[Directory Context]");
    expect(blocks[0]?.summary).toBe(path);
    expect(blocks[0]?.text).toContain("Still AGENTS content.");
    expect(blocks[1]).toEqual({ kind: "user", text: userText });
  });

  test("falls back to the first delimiter line when the source file cannot be read", () => {
    const path = "/workspace/project/AGENTS.md";
    const userText = "actual user request";
    const text = `[Directory Context: ${path}]\n# Old rules\n---\n${userText}`;

    const blocks = parseOmoBlocks(text, {
      directoryContextResolver: () => null,
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe("omo");
    expect(blocks[0]?.summary).toBe(path);
    expect(blocks[1]).toEqual({ kind: "user", text: userText });
  });

  test("copy text drops collapsed directory context", () => {
    const path = "/workspace/project/AGENTS.md";
    const text = `[Directory Context: ${path}]\n# Rules\n---\nactual user request`;

    expect(userTextFromOmoBlocks(parseOmoBlocks(text))).toBe(
      "actual user request",
    );
  });
});

describe("userTextFromOmoBlocks", () => {
  test("drops a leading stripped marker, keeps the user prose", () => {
    const meta = encodeURIComponent(
      JSON.stringify({
        id: "0.0",
        header: "[search-mode]",
        summary: "MAXIMIZE SEARCH EFFORT.",
        bytes: 317,
      }),
    );
    const text = `<!--OMO-STRIPPED:${meta}-->\nSeparate the concept of pins and favorites.`;

    expect(userTextFromOmoBlocks(parseOmoBlocks(text))).toBe(
      "Separate the concept of pins and favorites.",
    );
  });

  test("returns a plain message verbatim when no OMO block is present", () => {
    const text = "just a normal prompt\n\nwith a blank line";

    expect(userTextFromOmoBlocks(parseOmoBlocks(text))).toBe(text);
  });

  test("returns empty string for a message that is only an OMO directive", () => {
    const text = `<system-reminder>
[BACKGROUND TASK RESULT READY]
**ID:** \`bg_6b6a9cf0\`
</system-reminder>
<!-- OMO_INTERNAL_INITIATOR -->`;

    expect(userTextFromOmoBlocks(parseOmoBlocks(text))).toBe("");
  });

  test("keeps the real user text wrapped in system-reminder boilerplate", () => {
    const userText = "fix the hash-permalink crash";
    const text = `<system-reminder>
The user sent the following message:
${userText}

Please address this message and continue with your tasks.
</system-reminder>`;

    expect(userTextFromOmoBlocks(parseOmoBlocks(text))).toBe(userText);
  });
});
