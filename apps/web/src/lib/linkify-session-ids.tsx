import { Fragment } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

// Same regex shape as remark-id-links.ts so the linkize behaviour stays
// in sync between markdown bodies (the remark plugin) and raw-string
// surfaces (tool-call JSON view + formatted view). Lower-bound 9 chars
// after the ses_/msg_ prefix matches the short-prefix support; upper
// bound 32 prevents a stray ses_<huge gibberish> sponge attack from
// hijacking unrelated text.
const ID_REGEX =
  /(^|[\s'"\[\]{}()=:,;.])((?:ses_[A-Za-z0-9]{9,32})|(?:msg_[A-Za-z0-9]{20,32}))(?=$|[\s'"\[\]{}().,:;?!])/g;
const FULL_SES_MIN_CHARS = 20;

export interface LinkifySessionIdsOptions {
  resolveSessionId: (partialOrFullId: string) => string | null;
}

function SessionIdLink({
  href,
  label,
}: {
  href: string;
  label: string;
}): ReactNode {
  const navigate = useNavigate();
  return (
    <a
      href={href}
      className="text-primary hover:underline"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (e.button !== 0) return;
        e.preventDefault();
        try {
          const u = new URL(href, window.location.origin);
          void navigate({
            to: (u.pathname + u.search + u.hash) as string,
          });
        } catch {
          window.location.href = href;
        }
      }}
    >
      {label}
    </a>
  );
}

// Returns the input text with every ses_/msg_ id replaced by an inline
// link element, splicing literal text spans between matches. Short
// ses_ prefixes only linkize when resolveSessionId returns an
// unambiguous full id; ambiguous or unknown prefixes stay as plain
// text rather than producing a wrong link.
export function linkifySessionIds(
  text: string,
  options: LinkifySessionIdsOptions,
): ReactNode {
  if (!text || text.indexOf("ses_") < 0 && text.indexOf("msg_") < 0) {
    return text;
  }
  ID_REGEX.lastIndex = 0;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ID_REGEX.exec(text)) !== null) {
    const prefix = match[1] ?? "";
    const id = match[2];
    const matchStart = match.index + prefix.length;
    const matchEnd = matchStart + id.length;

    let targetId: string | null = id;
    if (id.startsWith("ses_")) {
      const charCount = id.length - "ses_".length;
      if (charCount < FULL_SES_MIN_CHARS) {
        targetId = options.resolveSessionId(id);
      }
    }
    if (targetId === null) continue;

    if (matchStart > lastIndex) {
      parts.push(text.slice(lastIndex, matchStart));
    }
    const href = id.startsWith("ses_")
      ? `/session/${targetId}`
      : `#msg-${id}`;
    parts.push(
      <SessionIdLink key={`${matchStart}-${id}`} href={href} label={id} />,
    );
    lastIndex = matchEnd;
  }
  if (parts.length === 0) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <Fragment>{parts}</Fragment>;
}
