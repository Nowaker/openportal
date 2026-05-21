import { visit, SKIP } from "unist-util-visit";

const PATH_REGEX = /(^|[\s'"\[\]{}()=:])((?:\/(?:[\w.-]+\/)+|~\/(?:[\w.-]+\/)*)[\w.-]*[\w])(?=$|[\s'"\[\]{}().,:;?!])/g;

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
        let match;
        let lastIndex = 0;
        const newChildren: any[] = [];

        PATH_REGEX.lastIndex = 0;
        while ((match = PATH_REGEX.exec(text)) !== null) {
          const path = match[2];
          if (path.startsWith("/api/")) continue;

          const matchStart = match.index + match[1].length;
          const matchEnd = matchStart + path.length;

          if (matchStart > lastIndex) {
            newChildren.push({
              type: "text",
              value: text.slice(lastIndex, matchStart),
            });
          }

          newChildren.push({
            type: "link",
            url: `file://${path}`,
            children: [{ type: "text", value: path }],
          });

          lastIndex = matchEnd;
        }

        if (newChildren.length > 0) {
          if (lastIndex < text.length) {
            newChildren.push({
              type: "text",
              value: text.slice(lastIndex),
            });
          }
          parent.children.splice(index, 1, ...newChildren);
          return index + newChildren.length;
        }
      }
      return undefined;
    });
  };
};
