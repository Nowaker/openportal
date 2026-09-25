import { describe, expect, test } from "bun:test";
import {
  asyncQuestionIdFromOutput,
  buildVibetermAnswers,
  isQuestionToolName,
  matchVibetermRequest,
  type VibetermQuestion,
  type VibetermQuestionRequest,
} from "./vibeterm-questions";

function question(index: number, over: Partial<VibetermQuestion> = {}): VibetermQuestion {
  return {
    index,
    header: `h${index}`,
    question: `q${index}?`,
    options: [
      { label: "yes", description: "" },
      { label: "no", description: "" },
    ],
    state: "pending",
    selected: [],
    comment: null,
    ...over,
  };
}

function request(id: string, over: Partial<VibetermQuestionRequest> = {}): VibetermQuestionRequest {
  return {
    id,
    sessionID: "ses_a",
    displaySessionID: "ses_a",
    directory: "/repo",
    messageID: "msg_a",
    askedMs: 1,
    closedMs: null,
    blocking: false,
    questions: [question(0), question(1)],
    ...over,
  };
}

describe("vibeterm question helpers", () => {
  test("recognizes both question tools", () => {
    expect(isQuestionToolName("question")).toBe(true);
    expect(isQuestionToolName("vibeterm_async_question")).toBe(true);
    expect(isQuestionToolName("bash")).toBe(false);
  });

  test("reads the request id from the async tool's reply", () => {
    const output = "outcome: recorded\nquestion_id: qst_0d539b5f5001vekto74Fdm5MEI\nappended: 1 question";
    expect(asyncQuestionIdFromOutput(output)).toBe("qst_0d539b5f5001vekto74Fdm5MEI");
    expect(asyncQuestionIdFromOutput("outcome: withdrawn")).toBeNull();
    expect(asyncQuestionIdFromOutput(undefined)).toBeNull();
  });

  test("matches by the asking tool call first", () => {
    const requests = [
      request("qst_1", { callID: "call_1" }),
      request("qst_2", { callID: "call_2" }),
    ];
    const text = [
      { header: "h0", question: "q0?" },
      { header: "h1", question: "q1?" },
    ];
    expect(matchVibetermRequest(requests, "call_2", null, text)?.id).toBe("qst_2");
    expect(matchVibetermRequest(requests, "call_2", "qst_1", text)?.id).toBe("qst_2");
    // Same questions, but asked by other calls: not this card's request.
    expect(matchVibetermRequest(requests, "call_9", null, text)).toBeUndefined();
  });

  test("matches by id when the tool named one, else by question text", () => {
    const requests = [request("qst_1"), request("qst_2")];
    expect(matchVibetermRequest(requests, null, "qst_2", [])?.id).toBe("qst_2");
    expect(matchVibetermRequest(requests, null, "qst_9", [])).toBeUndefined();

    const closed = request("qst_old", { closedMs: 5 });
    const open = request("qst_new");
    const text = [
      { header: "h0", question: "q0?" },
      { header: "h1", question: "q1?" },
    ];
    expect(matchVibetermRequest([closed, open], "call_x", null, text)?.id).toBe("qst_new");
    expect(matchVibetermRequest([closed], "call_x", null, text)?.id).toBe("qst_old");
    expect(matchVibetermRequest([open], "call_x", null, [{ header: "h0", question: "q0?" }])).toBeUndefined();
  });

  test("sends only filled, still-pending questions, with known labels", () => {
    const req = request("qst_1", {
      questions: [question(0), question(1), question(2, { state: "answered" })],
    });
    const answers = buildVibetermAnswers(
      req,
      { 0: ["yes", "made-up"], 2: ["no"] },
      { 1: "  free text  " },
    );
    expect(answers).toEqual([
      { index: 0, selected: ["yes"] },
      { index: 1, comment: "free text" },
    ]);
    expect(buildVibetermAnswers(req, {}, { 0: "   " })).toEqual([]);
  });
});
