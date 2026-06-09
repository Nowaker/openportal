import { create } from "zustand";

// Question tool callIDs the user has successfully answered this page-session.
// Mirrors the permission dismissal ref: after a successful submit (via
// question.reply OR the abort+prompt recovery path) opencode can take seconds
// to start the next turn, during which the frozen question tool part still
// reads status=running. Without this set the "waiting for your answer" banner
// lingers after the answer already landed. Keyed by callID because both the
// answer form and the blocking-banner memo have it natively. In-memory only:
// on reload the session has moved past the question, so the banner memo
// returns null on its own.
type State = {
  dismissed: Record<string, true>;
  dismiss: (callId: string) => void;
};

export const useDismissedQuestionsStore = create<State>((set) => ({
  dismissed: {},
  dismiss: (callId) =>
    set((s) =>
      !callId || s.dismissed[callId]
        ? s
        : { dismissed: { ...s.dismissed, [callId]: true } },
    ),
}));
