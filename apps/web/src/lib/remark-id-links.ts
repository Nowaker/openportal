import { visit, SKIP } from "unist-util-visit";

// Detect opencode session IDs (ses_*) and message IDs (msg_*) in chat
// text and rewrite them into internal links. Both kinds carry openportal
// significance:
//
//   ses_<sid>           -> /session/<sid> (open that session in the portal)
//   msg_<mid>           -> the current session, scrolled to that message
//                          (the markdown renderer can't see what session
//                          we're in from the plugin context, so we emit
//                          a relative `#msg-<mid>` hash and let the
//                          message-permalink loader resolve it when
//                          the link is clicked inside the same session).
//
// Pattern is anchored on word-boundary delimiters so we don't munge
// arbitrary identifiers that happen to contain "ses" or "msg".
//
// Both link targets are openportal-internal. The custom `a` component
// in MessageMarkdown (apps/web/src/routes/_app/session/$id.tsx ~ line
// 2004 onwards) already distinguishes internal anchors (no target=_blank)
// from external ones, so the emitted href just needs to be relative or
// same-origin.
const ID_REGEX =
  /(^|[\s'"\[\]{}()=:,;.])((?:ses_[A-Za-z0-9]{20,32})|(?:msg_[A-Za-z0-9]{20,32}))(?=$|[\s'"\[\]{}().,:;?!])/g;

interface MdastNode {
  type?: string;
  value?: string;
  children?: MdastNode[];
  url?: string;
}

export const remarkIdLinks = () => {
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

        if (matchStart > lastIndex) {
          newChildren.push({
            type: "text",
            value: text.slice(lastIndex, matchStart),
          });
        }

        const href = id.startsWith("ses_") ? `/session/${id}` : `#msg-${id}`;
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
