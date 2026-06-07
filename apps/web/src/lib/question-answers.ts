// Partition a user's QuestionAnswerForm submission into two disjoint
// surfaces:
//
//   - cleanAnswers: strings safe to send via opencode's
//     POST /question/<id>/reply API. opencode validates these against
//     q.options[].label for options-questions, so we MUST NOT mix
//     freeform notes with option labels (e.g. "Label\n\nfreeform"
//     does not match any allowed label and the question stays
//     pending — the user-reported stuck-session bug).
//
//   - customNotes: freeform text the user typed alongside a selected
//     option. Sent as a separate promptAsync BEFORE the reply so the
//     note lands as a user message in the session, and the assistant's
//     next turn (triggered by the reply resolving the question) sees
//     both the structured answer AND the contextual note.
//
// Decision tree per question:
//   - q.options.length === 0          → freeform IS the answer.
//   - selected.length > 0 + freeform  → option(s) clean; freeform = note.
//   - selected.length === 0 + freeform → textarea was shown ⇒ q.custom
//                                       is true ⇒ freeform is a valid
//                                       custom answer; no note.
//   - otherwise                        → empty answer.

export interface QuestionOptionLike {
  label: string;
  description?: string;
}

export interface QuestionLike {
  question: string;
  header: string;
  options: QuestionOptionLike[];
  multiple?: boolean;
  custom?: boolean;
}

export interface CustomNote {
  qIdx: number;
  header: string;
  question: string;
  note: string;
}

export interface PartitionedAnswers {
  cleanAnswers: string[][];
  customNotes: CustomNote[];
}

export function partitionQuestionAnswers(
  questions: QuestionLike[],
  selections: Record<number, string[]>,
  freeforms: Record<number, string>,
): PartitionedAnswers {
  const cleanAnswers: string[][] = [];
  const customNotes: CustomNote[] = [];

  questions.forEach((q, i) => {
    const selected = selections[i] ?? [];
    const freeform = (freeforms[i] ?? "").trim();

    if (q.options.length === 0) {
      cleanAnswers.push(freeform ? [freeform] : []);
      return;
    }

    if (selected.length > 0) {
      cleanAnswers.push([...selected]);
      if (freeform) {
        customNotes.push({
          qIdx: i,
          header: q.header,
          question: q.question,
          note: freeform,
        });
      }
      return;
    }

    if (freeform) {
      cleanAnswers.push([freeform]);
      return;
    }

    cleanAnswers.push([]);
  });

  return { cleanAnswers, customNotes };
}

export function formatCustomNotesAsPrompt(notes: CustomNote[]): string {
  if (notes.length === 0) return "";

  const preamble =
    notes.length === 1
      ? "Adding a note alongside my answer to your question:"
      : "Adding notes alongside my answers to your questions:";

  const blocks = notes.map((n) => {
    const headerPart = n.header ? `${n.header}: ` : "";
    return `> ${headerPart}${n.question}\n\n${n.note}`;
  });

  return `${preamble}\n\n${blocks.join("\n\n")}`;
}
