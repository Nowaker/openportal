import { Fragment } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

// Same regex shape as remark-id-links.ts so the linkize behaviour stays
// in sync between markdown bodies (the remark plugin) and raw-string
// surfaces (tool-call JSON view + formatted view). bg_ added for OMO
// background task ids that appear in <task_metadata> blocks.
const ID_REGEX =
  /(^|[\s'"\[\]{}()=:,;./?#&-])((?:ses_[A-Za-z0-9]{9,32})|(?:msg_[A-Za-z0-9]{20,32})|(?:bg_[A-Za-z0-9]{6,32}))(?=$|[\s'"\[\]{}().,:;?!/&#-])/g;
const FULL_SES_MIN_CHARS = 20;

export interface LinkifySessionIdsOptions {
  resolveSessionId: (partialOrFullId: string) => string | null;
  resolveBgId?: (bgId: string) => string | null;
  resolveSessionTitle?: (sessionId: string) => string | null;
}

function SessionIdLink({
  href,
  label,
  title,
}: {
  href: string;
  label: string;
  title: string | null;
}): ReactNode {
  const navigate = useNavigate();
  const anchor = (
    <a
      href={href}
      className="text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
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
  if (!title) return anchor;
  return (
    <span className="group relative inline-block">
      {anchor}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden whitespace-nowrap rounded-md border border-(--tooltip-border) [--tooltip-border:var(--color-muted-fg)]/30 bg-overlay px-2 py-1 text-xs text-overlay-fg shadow-md group-hover:block"
      >
        {title}
      </span>
    </span>
  );
}

function hrefAndTargetFor(
  id: string,
  options: LinkifySessionIdsOptions,
): { href: string; sessionId: string | null } | null {
  if (id.startsWith("msg_")) {
    return { href: `#msg-${id}`, sessionId: null };
  }
  if (id.startsWith("bg_")) {
    const ses = options.resolveBgId?.(id) ?? null;
    return ses === null ? null : { href: `/session/${ses}`, sessionId: ses };
  }
  let target: string | null = id;
  const charCount = id.length - "ses_".length;
  if (charCount < FULL_SES_MIN_CHARS) {
    target = options.resolveSessionId(id);
  }
  return target === null
    ? null
    : { href: `/session/${target}`, sessionId: target };
}

export function linkifySessionIds(
  text: string,
  options: LinkifySessionIdsOptions,
): ReactNode {
  if (
    !text ||
    (text.indexOf("ses_") < 0 &&
      text.indexOf("msg_") < 0 &&
      text.indexOf("bg_") < 0)
  ) {
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

    const resolved = hrefAndTargetFor(id, options);
    if (resolved === null) continue;

    if (matchStart > lastIndex) {
      parts.push(text.slice(lastIndex, matchStart));
    }
    const title =
      resolved.sessionId && options.resolveSessionTitle
        ? options.resolveSessionTitle(resolved.sessionId)
        : null;
    parts.push(
      <SessionIdLink
        key={`${matchStart}-${id}`}
        href={resolved.href}
        label={id}
        title={title}
      />,
    );
    lastIndex = matchEnd;
  }
  if (parts.length === 0) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <Fragment>{parts}</Fragment>;
}
