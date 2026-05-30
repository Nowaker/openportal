import { visit, SKIP } from "unist-util-visit";

// Detect opencode session IDs (ses_*) and message IDs (msg_*) in chat
// text and rewrite them into internal links. Two flavours:
//
//   ses_<full-id>       -> /session/<full-id>. Full IDs are 20-32
//                          alphanumeric chars; always linkized.
//   ses_<prefix>        -> /session/<resolved-full-id>. Short prefixes
//                          (9-19 alphanumeric chars) only linkize when
//                          options.resolveSessionId() can map the
//                          prefix back to a full ID via the portal's
//                          sessions cache. Ambiguous (multi-match) or
//                          unknown prefixes stay as text rather than
//                          producing dead /session/<short> links.
//   msg_<mid>           -> #msg-<mid> hash on the current session
//                          (the markdown renderer can't see what
//                          session we're in from plugin context).
//
// Pattern anchored on word-boundary delimiters so we don't munge
// arbitrary identifiers that happen to contain "ses" or "msg".
//
// Link targets are openportal-internal. MessageMarkdown's `a`
// component override routes them through tanstack SPA nav.
const ID_REGEX =
  /(^|[\s'"\[\]{}()=:,;./?#&-])((?:ses_[A-Za-z0-9]{9,32})|(?:msg_[A-Za-z0-9]{20,32}))(?=$|[\s'"\[\]{}().,:;?!/&#-])/g;

const FULL_SES_MIN_CHARS = 20;

export interface RemarkIdLinksOptions {
  resolveSessionId?: (partialOrFullId: string) => string | null;
}

interface MdastNode {
  type?: string;
  value?: string;
  children?: MdastNode[];
  url?: string;
}

export const remarkIdLinks = (options?: RemarkIdLinksOptions) => {
  return (tree: MdastNode) => {
    visit(tree, (node: MdastNode, index: number | undefined, parent: MdastNode | undefined) => {
      if (
        node.type === "link" ||
        node.type === "linkReference" ||
        node.type === "code" ||
        node.type === "inlineCode"
      ) {
        return SKIP;
      }
      if (node.type !== "text" || !parent || typeof index !== "number") return;
      const text = node.value ?? "";
      let match;
      let lastIndex = 0;
      const newChildren: MdastNode[] = [];
      ID_REGEX.lastIndex = 0;
      while ((match = ID_REGEX.exec(text)) !== null) {
        const id = match[2];
        const matchStart = match.index + match[1].length;
        const matchEnd = matchStart + id.length;

        let targetId: string | null = id;
        if (id.startsWith("ses_")) {
          const charCount = id.length - "ses_".length;
          if (charCount < FULL_SES_MIN_CHARS) {
            targetId = options?.resolveSessionId?.(id) ?? null;
          }
        }

        if (targetId === null) {
          // Short prefix that the cache can't resolve unambiguously.
          // Leave the match as literal text - splicing into newChildren
          // below would still happen if there are later resolvable
          // matches; the unresolved span is captured by the pre-text
          // slice on the next iteration's matchStart.
          continue;
        }

        if (matchStart > lastIndex) {
          newChildren.push({
            type: "text",
            value: text.slice(lastIndex, matchStart),
          });
        }

        const href = id.startsWith("ses_")
          ? `/session/${targetId}`
          : `#msg-${id}`;
        newChildren.push({
          type: "link",
          url: href,
          children: [{ type: "text", value: id }],
        });
        lastIndex = matchEnd;
      }
      if (newChildren.length > 0) {
        if (lastIndex < text.length) {
          newChildren.push({ type: "text", value: text.slice(lastIndex) });
        }
        parent.children!.splice(index, 1, ...(newChildren as MdastNode[]));
        return index + newChildren.length;
      }
      return undefined;
    });
  };
};
