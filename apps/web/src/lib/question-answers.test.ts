import { describe, expect, test } from "bun:test";
import {
  formatCustomNotesAsPrompt,
  partitionQuestionAnswers,
  type QuestionLike,
} from "./question-answers";

const radio: QuestionLike = {
  question: "Which part is cropped?",
  header: "Which part is cropped?",
  options: [
    { label: "Top edge", description: "" },
    { label: "Bottom edge", description: "" },
    { label: "Right side", description: "" },
  ],
  multiple: false,
  custom: true,
};

const multi: QuestionLike = {
  question: "Which icons should show?",
  header: "Icons",
  options: [
    { label: "Edit" },
    { label: "Fork" },
    { label: "Pin" },
  ],
  multiple: true,
  custom: true,
};

const freeformOnly: QuestionLike = {
  question: "What did you eat for breakfast?",
  header: "",
  options: [],
  multiple: false,
  custom: true,
};

const radioStrict: QuestionLike = {
  ...radio,
  custom: false,
};

describe("partitionQuestionAnswers", () => {
  test("radio + freeform → option goes to cleanAnswers, freeform goes to customNotes", () => {
    const out = partitionQuestionAnswers(
      [radio],
      { 0: ["Top edge"] },
      { 0: "actually it might also be the bottom" },
    );
    expect(out.cleanAnswers).toEqual([["Top edge"]]);
    expect(out.customNotes).toEqual([
      {
        qIdx: 0,
        header: "Which part is cropped?",
        question: "Which part is cropped?",
        note: "actually it might also be the bottom",
      },
    ]);
  });

  test("multi + freeform → selected labels clean, freeform separated as note", () => {
    const out = partitionQuestionAnswers(
      [multi],
      { 0: ["Edit", "Fork"] },
      { 0: "and please add Permalink too" },
    );
    expect(out.cleanAnswers).toEqual([["Edit", "Fork"]]);
    expect(out.customNotes).toEqual([
      {
        qIdx: 0,
        header: "Icons",
        question: "Which icons should show?",
        note: "and please add Permalink too",
      },
    ]);
  });

  test("only option selected, no freeform → no notes emitted", () => {
    const out = partitionQuestionAnswers([radio], { 0: ["Top edge"] }, {});
    expect(out.cleanAnswers).toEqual([["Top edge"]]);
    expect(out.customNotes).toEqual([]);
  });

  test("freeform-only question → freeform is the answer, no note", () => {
    const out = partitionQuestionAnswers(
      [freeformOnly],
      {},
      { 0: "oatmeal" },
    );
    expect(out.cleanAnswers).toEqual([["oatmeal"]]);
    expect(out.customNotes).toEqual([]);
  });

  test("freeform-only question with empty text → empty answer", () => {
    const out = partitionQuestionAnswers([freeformOnly], {}, { 0: "   " });
    expect(out.cleanAnswers).toEqual([[]]);
    expect(out.customNotes).toEqual([]);
  });

  test("options-having question with freeform only (no selection) → freeform sent as clean answer, no note", () => {
    const out = partitionQuestionAnswers(
      [radio],
      {},
      { 0: "none of these, the issue is on the side" },
    );
    expect(out.cleanAnswers).toEqual([["none of these, the issue is on the side"]]);
    expect(out.customNotes).toEqual([]);
  });

  test("custom=false question with no selection and no freeform → empty answer", () => {
    const out = partitionQuestionAnswers([radioStrict], {}, {});
    expect(out.cleanAnswers).toEqual([[]]);
    expect(out.customNotes).toEqual([]);
  });

  test("freeform trims whitespace before splitting", () => {
    const out = partitionQuestionAnswers(
      [radio],
      { 0: ["Top edge"] },
      { 0: "  \n  trimmed  \n  " },
    );
    expect(out.cleanAnswers).toEqual([["Top edge"]]);
    expect(out.customNotes[0]?.note).toBe("trimmed");
  });

  test("multiple questions: independent partition per index, customNotes preserves qIdx order", () => {
    const out = partitionQuestionAnswers(
      [radio, multi, freeformOnly],
      { 0: ["Top edge"], 1: ["Edit"] },
      { 0: "note on Q1", 1: "note on Q2", 2: "answer to Q3" },
    );
    expect(out.cleanAnswers).toEqual([
      ["Top edge"],
      ["Edit"],
      ["answer to Q3"],
    ]);
    expect(out.customNotes.map((n) => n.qIdx)).toEqual([0, 1]);
    expect(out.customNotes[0]?.note).toBe("note on Q1");
    expect(out.customNotes[1]?.note).toBe("note on Q2");
  });

  test("missing selection/freeform entries default to empty (no crash)", () => {
    const out = partitionQuestionAnswers([radio, multi], {}, {});
    expect(out.cleanAnswers).toEqual([[], []]);
    expect(out.customNotes).toEqual([]);
  });

  test("non-empty selection but empty-string freeform → no note", () => {
    const out = partitionQuestionAnswers(
      [radio],
      { 0: ["Top edge"] },
      { 0: "" },
    );
    expect(out.cleanAnswers).toEqual([["Top edge"]]);
    expect(out.customNotes).toEqual([]);
  });
});

describe("formatCustomNotesAsPrompt", () => {
  test("empty list returns empty string", () => {
    expect(formatCustomNotesAsPrompt([])).toBe("");
  });

  test("single note: singular preamble + blockquoted question + body", () => {
    const out = formatCustomNotesAsPrompt([
      {
        qIdx: 0,
        header: "Icons",
        question: "Which icons should show?",
        note: "also add Permalink",
      },
    ]);
    expect(out).toBe(
      "Adding a note alongside my answer to your question:\n\n> Icons: Which icons should show?\n\nalso add Permalink",
    );
  });

  test("multiple notes: plural preamble + blank-line separators", () => {
    const out = formatCustomNotesAsPrompt([
      {
        qIdx: 0,
        header: "Q1",
        question: "First?",
        note: "one",
      },
      {
        qIdx: 1,
        header: "Q2",
        question: "Second?",
        note: "two",
      },
    ]);
    expect(out).toBe(
      "Adding notes alongside my answers to your questions:\n\n> Q1: First?\n\none\n\n> Q2: Second?\n\ntwo",
    );
  });

  test("header-less question omits the leading 'header:' part", () => {
    const out = formatCustomNotesAsPrompt([
      {
        qIdx: 0,
        header: "",
        question: "Standalone?",
        note: "yep",
      },
    ]);
    expect(out).toBe(
      "Adding a note alongside my answer to your question:\n\n> Standalone?\n\nyep",
    );
  });

  test("multiline note is preserved verbatim", () => {
    const out = formatCustomNotesAsPrompt([
      {
        qIdx: 0,
        header: "Q",
        question: "Tell me more",
        note: "line one\nline two\nline three",
      },
    ]);
    expect(out).toContain("line one\nline two\nline three");
  });
});
