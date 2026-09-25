// vibeterm's own question store (questions.db), served by vibeterm-api as
// /vibeterm/question and proxied here as /api/opencode/<port>/vibeterm-*.
//
// Two tool calls end up there instead of in opencode's question registry:
//   - vibeterm_async_question, always. Its tool part COMPLETES at once and
//     the agent keeps working; the answer arrives later as a user message.
//   - the builtin `question` tool when vibeterm's questions.shadowBuiltin
//     routes it through vibeterm (blocking or async).
// Neither is listed by /question, so the native form's recovery path -
// abort the "wedged" turn and re-prompt - must never run for them: the
// turn is not wedged, the agent is working. Answering goes through
// vibeterm-api, which delivers via the Vibeterm pane's own submit helper.

export const ASYNC_QUESTION_TOOL = "vibeterm_async_question";

export function isQuestionToolName(tool: string | undefined): boolean {
  const name = (tool ?? "").toLowerCase();
  return name === "question" || name === ASYNC_QUESTION_TOOL;
}

export function isAsyncQuestionToolName(tool: string | undefined): boolean {
  return (tool ?? "").toLowerCase() === ASYNC_QUESTION_TOOL;
}

// `unconfirmed`: delivery may have reached the session but was never
// confirmed (a lost acknowledgement, or a helper that died mid-delivery).
// vibeterm will not send it again, so neither may this card.
export type VibetermQuestionState =
  | "pending"
  | "sending"
  | "unconfirmed"
  | "answered"
  | "denied"
  | "dismissed";

export interface VibetermQuestion {
  index: number;
  header: string;
  question: string;
  options: { label: string; description: string }[];
  multiple?: boolean;
  state: VibetermQuestionState;
  selected: string[];
  comment: string | null;
}

export interface VibetermQuestionRequest {
  id: string;
  sessionID: string;
  displaySessionID: string;
  directory: string | null;
  messageID: string | null;
  // The tool call that asked. Null on requests recorded before vibeterm kept
  // it, and on a vibeterm-api too old to report it.
  callID?: string | null;
  askedMs: number;
  closedMs: number | null;
  blocking: boolean;
  questions: VibetermQuestion[];
}

export type VibetermQuestionLookup =
  | { supported: false }
  | { supported: true; requests: VibetermQuestionRequest[] };

export function isUnsettled(q: VibetermQuestion): boolean {
  return q.state === "pending" || q.state === "sending";
}

// The tool's reply names the request: "question_id: qst_...".
export function asyncQuestionIdFromOutput(output: unknown): string | null {
  if (typeof output !== "string") return null;
  return /^question_id:\s*(qst_\S+)/m.exec(output)?.[1] ?? null;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { data?: { message?: string }; message?: string };
    return body.data?.message ?? body.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// Every request asked by one assistant message, settled ones included so
// a card for an answered question can say so. A server without the routes
// (a vibeterm-api predating them) answers 404 naming no route, or 503 with
// no store wired; a plain `opencode serve` answers its web app's HTML. All
// three read as unsupported.
export async function fetchVibetermQuestions(
  port: number,
  sessionID: string,
  messageID: string,
): Promise<VibetermQuestionLookup> {
  const query = new URLSearchParams({ sessionID, messageID, includeClosed: "1" });
  const res = await fetch(`/api/opencode/${port}/vibeterm-questions?${query}`);
  if (res.status === 404 || res.status === 503) return { supported: false };
  if (!res.ok) throw new Error(await errorMessage(res));
  if (!(res.headers.get("content-type") ?? "").includes("json")) return { supported: false };
  const requests: unknown = await res.json();
  if (!Array.isArray(requests)) return { supported: false };
  return { supported: true, requests: requests as VibetermQuestionRequest[] };
}

export function vibetermQuestionsKey(
  port: number,
  sessionID: string,
  messageID: string,
): string {
  return `vibeterm-questions:${port}:${sessionID}:${messageID}`;
}

interface QuestionText {
  header: string;
  question: string;
}

// The request a tool part asked. Its tool call id names it exactly. Failing
// that, an async call names the request id in its output. A request recorded
// before vibeterm kept call ids is matched by its questions, which one
// message can only ask identically by asking twice - but never a request that
// names a different call, which belongs to another card.
export function matchVibetermRequest(
  requests: readonly VibetermQuestionRequest[],
  callID: string | null,
  questionId: string | null,
  questions: readonly QuestionText[],
): VibetermQuestionRequest | undefined {
  const byCall = callID ? requests.find((r) => r.callID === callID) : undefined;
  if (byCall) return byCall;
  if (questionId) return requests.find((r) => r.id === questionId);
  const sameText = (r: VibetermQuestionRequest) =>
    (r.callID ?? null) === null &&
    r.questions.length === questions.length &&
    r.questions.every(
      (q, i) => q.header === questions[i]?.header && q.question === questions[i]?.question,
    );
  const candidates = requests.filter(sameText);
  return candidates.find((r) => r.closedMs === null) ?? candidates[candidates.length - 1];
}

export interface VibetermReplyBody {
  answers?: { index: number; selected?: string[]; comment?: string }[];
  deny?: number[];
  dismiss?: number[];
}

// The filled, still-unsettled questions of one form, as a reply carries
// them. A question with nothing chosen and nothing typed stays outstanding
// rather than being sent as a refusal.
export function buildVibetermAnswers(
  request: VibetermQuestionRequest,
  selections: Record<number, string[]>,
  freeforms: Record<number, string>,
): VibetermReplyBody["answers"] {
  const answers: NonNullable<VibetermReplyBody["answers"]> = [];
  for (const q of request.questions) {
    if (q.state !== "pending") continue;
    const labels = new Set(q.options.map((o) => o.label));
    const selected = (selections[q.index] ?? []).filter((l) => labels.has(l));
    const comment = (freeforms[q.index] ?? "").trim();
    if (selected.length === 0 && comment.length === 0) continue;
    answers.push({
      index: q.index,
      ...(selected.length > 0 ? { selected } : {}),
      ...(comment ? { comment } : {}),
    });
  }
  return answers;
}

export interface VibetermReplyResult {
  state: "delivered" | "sending" | "unconfirmed";
  request: VibetermQuestionRequest;
}

export async function replyVibetermQuestion(
  port: number,
  requestId: string,
  body: VibetermReplyBody,
): Promise<VibetermReplyResult> {
  const res = await fetch(
    `/api/opencode/${port}/vibeterm-question/${encodeURIComponent(requestId)}/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as VibetermReplyResult;
}
