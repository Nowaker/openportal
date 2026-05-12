import { describe, expect, test } from "bun:test";

import { filterPrompt, redactCredentials } from "./prompt-filter";

describe("filterPrompt: short pings", () => {
  test("plain 'Continue' is dropped", () => {
    const r = filterPrompt("Continue");
    expect(r.shouldArchive).toBe(false);
    expect(r.filtered).toBe("Continue");
  });

  test("trimmed-whitespace 'Continue' is dropped", () => {
    const r = filterPrompt("  Continue\n");
    expect(r.shouldArchive).toBe(false);
  });

  test("lowercase 'continue' is dropped (case-insensitive)", () => {
    expect(filterPrompt("continue").shouldArchive).toBe(false);
  });

  test("the long 'continue if you have next steps' ping is dropped", () => {
    const r = filterPrompt(
      "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.",
    );
    expect(r.shouldArchive).toBe(false);
  });

  test("'Ping' / 'Proceed' / 'Go' alone are dropped", () => {
    expect(filterPrompt("Ping").shouldArchive).toBe(false);
    expect(filterPrompt("Proceed").shouldArchive).toBe(false);
    expect(filterPrompt("Go").shouldArchive).toBe(false);
  });

  test("real prose containing the word 'continue' is kept", () => {
    const r = filterPrompt(
      "Continue from where you left off and refactor the parser to be stream-friendly.",
    );
    expect(r.shouldArchive).toBe(true);
    expect(r.filtered).toContain("refactor the parser");
  });
});

describe("filterPrompt: too short", () => {
  test("empty input is dropped", () => {
    expect(filterPrompt("").shouldArchive).toBe(false);
  });

  test("two-char input is dropped", () => {
    expect(filterPrompt("Ok").shouldArchive).toBe(false);
  });

  test("input that becomes <10 chars after stripping is dropped", () => {
    const r = filterPrompt(
      "<system-reminder>BIG SCARY THING</system-reminder>\nhi",
    );
    expect(r.shouldArchive).toBe(false);
    expect(r.filtered).toBe("hi");
  });
});

describe("filterPrompt: <system-reminder> blocks", () => {
  test("single block is stripped", () => {
    const input = "What's the weather?\n<system-reminder>Internal\nmultiline\nnote</system-reminder>";
    const r = filterPrompt(input);
    expect(r.filtered).toBe("What's the weather?");
    expect(r.shouldArchive).toBe(true);
  });

  test("multiple blocks are stripped", () => {
    const input =
      "Real prompt here.\n<system-reminder>noise</system-reminder>\nMore prompt.\n<system-reminder>more noise</system-reminder>";
    const r = filterPrompt(input);
    expect(r.filtered).toContain("Real prompt here.");
    expect(r.filtered).toContain("More prompt.");
    expect(r.filtered).not.toContain("noise");
  });

  test("unfiltered version retains the block", () => {
    const r = filterPrompt(
      "Prompt body.\n<system-reminder>retained</system-reminder>",
    );
    expect(r.unfiltered).toContain("<system-reminder>retained</system-reminder>");
  });
});

describe("filterPrompt: <ultrawork-mode> blocks", () => {
  test("entire ultrawork-mode block is stripped including content", () => {
    const input =
      "<ultrawork-mode>\n\n**MANDATORY**: You MUST say...\n\n# Some giant directive\n\n</ultrawork-mode>\n\nNew feature: prompt archive";
    const r = filterPrompt(input);
    expect(r.filtered).toBe("New feature: prompt archive");
  });
});

describe("filterPrompt: bracket directive blocks", () => {
  test("[search-mode] block ending at --- is stripped", () => {
    const input = `[search-mode]
MAXIMIZE SEARCH EFFORT. Launch multiple background agents IN PARALLEL.
NEVER stop at first result - be exhaustive.

[analyze-mode]
ANALYSIS MODE. Gather context.
---

Real user content begins here.`;
    const r = filterPrompt(input);
    expect(r.filtered).toBe("Real user content begins here.");
  });

  test("[ULTRAWORK] block ending at blank+non-bracket line is stripped", () => {
    const input = `[ULTRAWORK]
Big preamble paragraph.
Another preamble line.

Actual user prompt.`;
    const r = filterPrompt(input);
    expect(r.filtered).toBe("Actual user prompt.");
  });

  test("[RALPH LOOP 3/5] block is stripped", () => {
    const input = `[RALPH LOOP 3/5]
Iteration directive.
---
Real prompt.`;
    expect(filterPrompt(input).filtered).toBe("Real prompt.");
  });

  test("[SYSTEM DIRECTIVE - OH-MY-OPENCODE - TODO CONTINUATION] block without --- consumes the whole message (it's an auto-fired hook payload, not user content)", () => {
    const input = `[SYSTEM DIRECTIVE - OH-MY-OPENCODE - TODO CONTINUATION]

Incomplete tasks remain. Continue.
- Proceed without asking
- Mark each task complete

[Status: 8/10 completed]

Remaining tasks:
- [pending] foo`;
    const r = filterPrompt(input);
    expect(r.shouldArchive).toBe(false);
    expect(r.filtered).toBe("");
  });

  test("[SYSTEM DIRECTIVE] followed by --- and real content keeps the trailing user prompt", () => {
    const input = `[SYSTEM DIRECTIVE - OH-MY-OPENCODE - TODO CONTINUATION]

Incomplete tasks remain.
[Status: 1/1 completed]

---

Here is what I actually want.`;
    const r = filterPrompt(input);
    expect(r.shouldArchive).toBe(true);
    expect(r.filtered).toBe("Here is what I actually want.");
  });

  test("MANDATORY delegate_task block is stripped", () => {
    const input = `MANDATORY delegate_task params: ALWAYS include load_skills=[] and run_in_background.
Example: delegate_task(subagent_type="explore", ...)

Real prompt content.`;
    const r = filterPrompt(input);
    expect(r.filtered).toBe("Real prompt content.");
  });
});

describe("filterPrompt: continuation preludes", () => {
  test("'Up next when this done:' line is stripped", () => {
    const r = filterPrompt(
      "Up next when this done:\nFix the bug in foo.ts",
    );
    expect(r.filtered).toBe("Fix the bug in foo.ts");
  });

  test("'Queue right after:' line is stripped", () => {
    const r = filterPrompt(
      "Queue right after:\nAdd a new endpoint for X.",
    );
    expect(r.filtered).toBe("Add a new endpoint for X.");
  });

  test("'Remember to update your todos.' line is stripped", () => {
    const r = filterPrompt(
      "Remember to update your todos.\nNow implement the search feature.",
    );
    expect(r.filtered).toBe("Now implement the search feature.");
  });

  test("'Final task to enqueue ...' line is stripped, body kept", () => {
    const r = filterPrompt(
      "Final task to enqueue at the very end of the backlog.\nFix the recurring 500 error on assets.",
    );
    expect(r.filtered).toBe(
      "Fix the recurring 500 error on assets.",
    );
  });
});

describe("filterPrompt: blank-line collapse", () => {
  test("4 blank lines collapse to 2", () => {
    const r = filterPrompt("Line one.\n\n\n\n\nLine two.");
    expect(r.filtered).toBe("Line one.\n\nLine two.");
  });

  test("leading/trailing whitespace is trimmed", () => {
    const r = filterPrompt("\n\n  Real content.  \n\n");
    expect(r.filtered).toBe("Real content.");
  });
});

describe("redactCredentials: env-var style", () => {
  test("ALL_CAPS=long_value is redacted on a single line", () => {
    const out = redactCredentials("MY_FIXTURE_KEY=sk-proj-xxxxxxxxxxxxxxxxxx");
    expect(out).toBe("MY_FIXTURE_KEY=[REDACTED:length=26]");
  });

  test("'export FOO=bar' form is redacted", () => {
    const out = redactCredentials("export MISTRAL_API_KEY=abc12345678");
    expect(out).toBe("export MISTRAL_API_KEY=[REDACTED:length=11]");
  });

  test("short values are NOT redacted (likely not a secret)", () => {
    const out = redactCredentials("FOO=short");
    expect(out).toBe("FOO=short");
  });

  test("non-uppercase keys are NOT redacted", () => {
    const out = redactCredentials("my_var=longvaluehere");
    expect(out).toBe("my_var=longvaluehere");
  });
});

describe("redactCredentials: token patterns", () => {
  test("sk-... openai-style token is redacted inline", () => {
    const out = redactCredentials(
      "Use this key: sk-abcdefghijklmnopqrstuvwxyz to call the API",
    );
    expect(out).toContain("[REDACTED:length=29]");
    expect(out).not.toContain("sk-abcdefghij");
  });

  test("sk-ant-... anthropic-style token is redacted", () => {
    const out = redactCredentials(
      "key: sk-ant-api03-abc123def456ghi789jkl012",
    );
    expect(out).toContain("[REDACTED:length=");
    expect(out).not.toContain("sk-ant-api03-abc");
  });

  test("ghp_ github personal access token is redacted", () => {
    const out = redactCredentials(
      "token=ghp_abcdefghijklmnopqrstuvwxyz0123456",
    );
    expect(out).toContain("[REDACTED:length=");
    expect(out).not.toContain("ghp_abcd");
  });

  test("JWT-shaped token is redacted", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc-def_ghi";
    const out = redactCredentials(`Bearer ${jwt}`);
    expect(out).toContain("[REDACTED:length=");
    expect(out).not.toContain(jwt);
  });

  test("AWS access key id pattern is redacted", () => {
    const out = redactCredentials("AKIAIOSFODNN7EXAMPLE is the access key");
    expect(out).toContain("[REDACTED:length=20]");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});

describe("redactCredentials: fenced env code blocks", () => {
  test("```env block has body redacted", () => {
    const out = redactCredentials(
      "```env\nFOO=bar\nBAZ=qux\n```",
    );
    expect(out).toContain("[REDACTED:length=");
    expect(out).not.toContain("FOO=bar");
    expect(out).not.toContain("BAZ=qux");
    expect(out).toContain("```env");
  });

  test("```dotenv block has body redacted", () => {
    const out = redactCredentials("```dotenv\nSECRET=abc\n```");
    expect(out).not.toContain("SECRET=abc");
  });

  test("```secrets block has body redacted", () => {
    const out = redactCredentials("```secrets\nsensitive data\n```");
    expect(out).not.toContain("sensitive data");
  });

  test("regular ```bash block is NOT redacted", () => {
    const out = redactCredentials("```bash\necho 'hello'\n```");
    expect(out).toContain("echo 'hello'");
  });
});

describe("end-to-end: realistic ralph/ultrawork-laden prompt", () => {
  test("ULTRAWORK preamble + multi-block directive is stripped to actual content", () => {
    const input = `<ultrawork-mode>

**MANDATORY**: You MUST say "ULTRAWORK MODE ENABLED!" first.

[CODE RED] Maximum precision required.

## ABSOLUTE CERTAINTY REQUIRED

YOU MUST NOT START ANY IMPLEMENTATION UNTIL YOU ARE 100% CERTAIN.

</ultrawork-mode>



[search-mode]
MAXIMIZE SEARCH EFFORT.
NEVER stop at first result.

[analyze-mode]
ANALYSIS MODE. Gather context before diving deep.

SYNTHESIZE findings before proceeding.
---
MANDATORY delegate_task params: ALWAYS include load_skills=[] and run_in_background.
Example: delegate_task(subagent_type="explore", ...)

---

New feature: openportal-native user-prompt archive

**Why this matters**

I just lost ~3 prompts because opencode auto-reverted a content-filter-rejected branch.`;

    const r = filterPrompt(input);
    expect(r.shouldArchive).toBe(true);
    expect(r.filtered).toContain("New feature: openportal-native user-prompt archive");
    expect(r.filtered).toContain("I just lost ~3 prompts");
    expect(r.filtered).not.toContain("ULTRAWORK MODE ENABLED");
    expect(r.filtered).not.toContain("MAXIMIZE SEARCH EFFORT");
    expect(r.filtered).not.toContain("MANDATORY delegate_task");
    expect(r.filtered).not.toContain("[CODE RED]");
  });

  test("system reminder + [SYSTEM DIRECTIVE] hook fire (no ---) is a full noise message", () => {
    const input = `<system-reminder>
[ALL BACKGROUND TASKS COMPLETE]

**Completed:**
- bg_xxx: thing

Use \`background_output\` to retrieve.
</system-reminder>
<!-- OMO_INTERNAL_INITIATOR -->

[SYSTEM DIRECTIVE - OH-MY-OPENCODE - TODO CONTINUATION]

Incomplete tasks remain. Continue working.

Remaining tasks:
- [pending] foo`;

    const r = filterPrompt(input);
    expect(r.shouldArchive).toBe(false);
    expect(r.filtered).toBe("");
  });

  test("prelude + real content: prelude line stripped, content kept", () => {
    const input = `Remember to update your todos.

Here is what I actually want: implement a tree view in the sidebar that shows nested projects.`;
    const r = filterPrompt(input);
    expect(r.shouldArchive).toBe(true);
    expect(r.filtered).toContain("implement a tree view");
    expect(r.filtered).not.toContain("Remember to update");
  });
});

describe("filterPrompt: unfiltered preserves noise; credentials redacted in BOTH", () => {
  test("inline sk-proj-... credential is redacted by token pattern; noise visible in unfiltered only", () => {
    const input = `<system-reminder>noise</system-reminder>
Hey can you check MY_KEY=sk-proj-abcdefghijklmnop for me`;

    const r = filterPrompt(input);

    expect(r.unfiltered).toContain("<system-reminder>");
    expect(r.unfiltered).toContain("[REDACTED:length=");
    expect(r.unfiltered).not.toContain("sk-proj-abcdef");

    expect(r.filtered).not.toContain("<system-reminder>");
    expect(r.filtered).toContain("[REDACTED:length=");
    expect(r.filtered).not.toContain("sk-proj-abcdef");
  });
});
