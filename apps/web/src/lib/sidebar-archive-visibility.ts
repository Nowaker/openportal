import type { Session } from "@opencode-ai/sdk";

export function shouldAutoExpandArchivedSection(
  isExpanded: boolean,
  currentSessionId: string | undefined,
  archivedSessions: Session[],
): boolean {
  if (!isExpanded || !currentSessionId) return false;
  return archivedSessions.some((session) => session.id === currentSessionId);
}

export function archivedRowIsCurrent(
  sessionId: string,
  currentSessionId: string | undefined,
): boolean {
  return sessionId === currentSessionId;
}
