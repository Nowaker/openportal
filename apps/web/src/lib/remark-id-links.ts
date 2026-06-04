import { visit, SKIP } from "unist-util-visit";

const ID_REGEX =
  /(^|[\s'"\[\]{}()=:,;./?#&-])((?:ses_[A-Za-z0-9]{9,32})|(?:msg_[A-Za-z0-9]{20,32})|(?:bg_[A-Za-z0-9]{6,32}))(?=$|[\s'"\[\]{}().,:;?!/&#-])/g;

const FULL_SES_MIN_CHARS = 20;

export interface RemarkIdLinksOptions {
  resolveSessionId?: (partialOrFullId: string) => string | null;
  resolveBgId?: (bgId: string) => string | null;
}

function hrefForId(
  id: string,
  options: RemarkIdLinksOptions | undefined,
): string | null {
  if (id.startsWith("msg_")) return `#msg-${id}`;
  if (id.startsWith("bg_")) {
    const ses = options?.resolveBgId?.(id) ?? null;
    return ses === null ? null : `/session/${ses}`;
  }
  let target: string | null = id;
  const charCount = id.length - "ses_".length;
  if (charCount < FULL_SES_MIN_CHARS) {
    target = options?.resolveSessionId?.(id) ?? null;
  }
  return target === null ? null : `/session/${target}`;
}

interface MdastNode {
  type?: string;
  value?: string;
  children?: MdastNode[];
  url?: string;
}

export const remarkIdLinks = (options?: RemarkIdLinksOptions) => {
  return (tree: MdastNode) => {
    visit(tree as Parameters<typeof visit>[0], (rawNode, rawIndex, rawParent) => {
      const node = rawNode as MdastNode;
      const parent = rawParent as MdastNode | undefined;
      const index = rawIndex;

      if (node.type === "link" || node.type === "linkReference" || node.type === "code") {
        return SKIP;
      }
      if (node.type === "inlineCode" && parent && typeof index === "number") {
        const value = node.value ?? "";
        const m = value.match(/^(ses_[A-Za-z0-9]{9,32}|msg_[A-Za-z0-9]{20,32}|bg_[A-Za-z0-9]{6,32})$/);
        if (!m) return;
        const id = m[1];
        const href = hrefForId(id, options);
        if (href === null) return;
        parent.children!.splice(index, 1, {
          type: "link",
          url: href,
          children: [{ type: "text", value: id }],
        });
        return index + 1;
      }
      if (node.type === "html" && parent && typeof index === "number") {
        const value = node.value ?? "";
        if (
          value.indexOf("ses_") < 0 &&
          value.indexOf("msg_") < 0 &&
          value.indexOf("bg_") < 0
        ) {
          return undefined;
        }
        let m;
        let last = 0;
        const out: MdastNode[] = [];
        ID_REGEX.lastIndex = 0;
        while ((m = ID_REGEX.exec(value)) !== null) {
          const id = m[2];
          const ms = m.index + m[1].length;
          const me = ms + id.length;
          const href = hrefForId(id, options);
          if (href === null) continue;
          if (ms > last) {
            out.push({ type: "html", value: value.slice(last, ms) });
          }
          out.push({
            type: "link",
            url: href,
            children: [{ type: "text", value: id }],
          });
          last = me;
        }
        if (out.length === 0) return undefined;
        if (last < value.length) {
          out.push({ type: "html", value: value.slice(last) });
        }
        parent.children!.splice(index, 1, ...(out as MdastNode[]));
        return index + out.length;
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
        const href = hrefForId(id, options);

        if (href === null) {
          continue;
        }

        if (matchStart > lastIndex) {
          newChildren.push({
            type: "text",
            value: text.slice(lastIndex, matchStart),
          });
        }

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
