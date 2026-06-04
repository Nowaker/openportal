import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { Session } from "@opencode-ai/sdk";
import type { MessageWithParts } from "@/hooks/use-session-messages";
import { formatFullDateTime } from "@/lib/format-time";
import { useDateFormatStore, type DateFormat } from "@/stores/date-format-store";

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

const TASK_METADATA_PAIR_REGEXES = [
  /background_task_id:\s*(bg_[A-Za-z0-9]{6,32})[\s\S]{0,200}?session_id:\s*(ses_[A-Za-z0-9]{20,32})/g,
  /session_id:\s*(ses_[A-Za-z0-9]{20,32})[\s\S]{0,200}?background_task_id:\s*(bg_[A-Za-z0-9]{6,32})/g,
  /Background Task ID:\s*(bg_[A-Za-z0-9]{6,32})[\s\S]{0,600}?session_id:\s*(ses_[A-Za-z0-9]{20,32})/g,
  /(bg_[A-Za-z0-9]{6,32})[^A-Za-z0-9_]{0,50}?(?:->|→|=>)[^A-Za-z0-9_]{0,80}?\/?session\/?(ses_[A-Za-z0-9]{20,32})/g,
  /(bg_[A-Za-z0-9]{6,32})\s*->\s*(ses_[A-Za-z0-9]{20,32})/g,
];

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
      for (const regex of TASK_METADATA_PAIR_REGEXES) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(blob)) !== null) {
          const a = match[1];
          const b = match[2];
          const bg = a.startsWith("bg_") ? a : b;
          const ses = a.startsWith("ses_") ? a : b;
          if (!map.has(bg)) map.set(bg, ses);
        }
      }
    }
  }
  return map;
}

function formatSessionDescriptor(s: Session, format: DateFormat): string {
  const dt = formatFullDateTime(s.time?.created, format);
  const title = s.title || "(untitled)";
  return dt ? `${s.id} - ${dt} - ${title}` : `${s.id} - ${title}`;
}

function buildSessionTitleMap(
  sessions: Session[],
  format: DateFormat,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of sessions) {
    if (s.id) map.set(s.id, formatSessionDescriptor(s, format));
  }
  return map;
}

export function useBuildIdResolvers(
  sessions: Session[],
  messages: MessageWithParts[],
): IdResolvers {
  const dateFormat = useDateFormatStore((s) => s.format);
  const sessionTitleMap = useMemo(
    () => buildSessionTitleMap(sessions, dateFormat),
    [sessions, dateFormat],
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
