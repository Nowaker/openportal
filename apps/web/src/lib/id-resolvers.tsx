import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { Session } from "@opencode-ai/sdk";
import type { MessageWithParts } from "@/hooks/use-session-messages";

export interface IdResolvers {
  resolveSessionId: (partialOrFullId: string) => string | null;
  resolveBgId: (bgId: string) => string | null;
  resolveSessionTitle: (sessionId: string) => string | null;
}

const NULL_RESOLVERS: IdResolvers = {
  resolveSessionId: () => null,
  resolveBgId: () => null,
  resolveSessionTitle: () => null,
};

const IdResolversContext = createContext<IdResolvers>(NULL_RESOLVERS);

const FULL_SES_MIN_CHARS = 20;

const BG_NEAR_SES_REGEX =
  /(bg_[A-Za-z0-9]{6,32})[\s\S]{0,400}?(ses_[A-Za-z0-9]{20,32})|(ses_[A-Za-z0-9]{20,32})[\s\S]{0,400}?(bg_[A-Za-z0-9]{6,32})/g;

function buildBgIdMap(messages: MessageWithParts[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    for (const part of m.parts) {
      const p = part as {
        type?: string;
        text?: string;
        state?: { metadata?: Record<string, unknown>; output?: unknown };
      };
      const blob = JSON.stringify({
        text: typeof p.text === "string" ? p.text : "",
        metadata: p.state?.metadata ?? null,
        output: p.state?.output ?? null,
      });
      if (blob.indexOf("bg_") < 0) continue;
      BG_NEAR_SES_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = BG_NEAR_SES_REGEX.exec(blob)) !== null) {
        const bg = match[1] ?? match[4];
        const ses = match[2] ?? match[3];
        if (bg && ses && !map.has(bg)) map.set(bg, ses);
      }
    }
  }
  return map;
}

function buildSessionTitleMap(sessions: Session[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of sessions) {
    if (s.id && s.title) map.set(s.id, s.title);
  }
  return map;
}

export function useBuildIdResolvers(
  sessions: Session[],
  messages: MessageWithParts[],
): IdResolvers {
  const sessionTitleMap = useMemo(
    () => buildSessionTitleMap(sessions),
    [sessions],
  );
  const bgIdMap = useMemo(() => buildBgIdMap(messages), [messages]);
  return useMemo<IdResolvers>(() => {
    return {
      resolveSessionId: (partial) => {
        if (!partial.startsWith("ses_")) return null;
        if (sessionTitleMap.has(partial)) return partial;
        const charCount = partial.length - "ses_".length;
        if (charCount >= FULL_SES_MIN_CHARS) return partial;
        const matches: string[] = [];
        for (const id of sessionTitleMap.keys()) {
          if (id.startsWith(partial)) {
            matches.push(id);
            if (matches.length > 1) break;
          }
        }
        return matches.length === 1 ? matches[0] : null;
      },
      resolveBgId: (bg) => bgIdMap.get(bg) ?? null,
      resolveSessionTitle: (sid) => sessionTitleMap.get(sid) ?? null,
    };
  }, [sessionTitleMap, bgIdMap]);
}

export function IdResolversProvider({
  value,
  children,
}: {
  value: IdResolvers;
  children: ReactNode;
}) {
  return (
    <IdResolversContext.Provider value={value}>
      {children}
    </IdResolversContext.Provider>
  );
}

export function useIdResolvers(): IdResolvers {
  return useContext(IdResolversContext);
}
