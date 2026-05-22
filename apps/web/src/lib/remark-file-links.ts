import { visit, SKIP } from "unist-util-visit";

// Path-shaped substrings in prose text. Three alternatives:
//   1. Absolute path:           /home/u/foo.txt, /etc/hosts, /api skipped
//   2. Tilde-anchored path:     ~/.config/opencode/opencode.json
//   3. Multi-segment relative:  apps/web/src/foo.ts (must contain /)
//   4. Single-token with ext:   PLUGIN_INVENTORY.md, README.md, foo.json
//
// (4) is intentionally aggressive (matches things like "foo.md" mid
// sentence). False positives are filtered by the server-side
// existence check that wraps each match - non-existent paths render
// as plain text, so the regex can be permissive without breaking
// prose. (1)-(3) also flow through the same existence check, so
// /api/, /usr/, and other "exists but irrelevant" paths still link.
//
// URL emitted is `file:///?path=<encodedPath>` rather than
// `file://<path>` because:
//   - `file://~/foo` confuses the URL parser into treating `~` as
//     the hostname, which loses the home-dir reference on click.
//   - `?path=<encoded>` carries any path verbatim through URL
//     parsing - including absolute, tilde, and relative - and the
//     click handler reads URLSearchParams.get("path") to recover it.
const PATTERNS: RegExp[] = [
  /(^|[\s'"\[\]{}()=:])(\/(?:[\w.-]+\/)+[\w.-]*[\w])(?=$|[\s'"\[\]{}().,:;?!])/g,
  /(^|[\s'"\[\]{}()=:])(~\/(?:[\w.-]+\/)*[\w.-]*[\w])(?=$|[\s'"\[\]{}().,:;?!])/g,
  /(^|[\s'"\[\]{}()=:])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8})(?=$|[\s'"\[\]{}().,:;?!])/g,
  /(^|[\s'"\[\]{}()=:])([A-Za-z][\w.-]*\.[A-Za-z0-9]{1,8})(?=$|[\s'"\[\]{}().,:;?!])/g,
];

function findMatches(text: string): Array<{ start: number; end: number; path: string }> {
  const seen: Array<{ start: number; end: number; path: string }> = [];
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const path = m[2];
      if (path.startsWith("/api/")) continue;
      const start = m.index + m[1].length;
      const end = start + path.length;
      const overlap = seen.some(
        (s) => !(end <= s.start || start >= s.end),
      );
      if (overlap) continue;
      seen.push({ start, end, path });
    }
  }
  seen.sort((a, b) => a.start - b.start);
  return seen;
}

function makeLinkUrl(path: string): string {
  return `file:///?path=${encodeURIComponent(path)}`;
}

export const remarkFileLinks = () => {
  return (tree: any) => {
    visit(tree, (node: any, index: number | undefined, parent: any) => {
      if (
        node.type === "link" ||
        node.type === "linkReference" ||
        node.type === "code" ||
        node.type === "inlineCode"
      ) {
        return SKIP;
      }

      if (node.type === "text" && parent && typeof index === "number") {
        const text = node.value;
        const matches = findMatches(text);
        if (matches.length === 0) return undefined;

        const newChildren: any[] = [];
        let cursor = 0;
        for (const m of matches) {
          if (m.start > cursor) {
            newChildren.push({ type: "text", value: text.slice(cursor, m.start) });
          }
          newChildren.push({
            type: "link",
            url: makeLinkUrl(m.path),
            children: [{ type: "text", value: m.path }],
          });
          cursor = m.end;
        }
        if (cursor < text.length) {
          newChildren.push({ type: "text", value: text.slice(cursor) });
        }
        parent.children.splice(index, 1, ...newChildren);
        return index + newChildren.length;
      }
      return undefined;
    });
  };
};
