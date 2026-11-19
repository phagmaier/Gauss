import type { MdNode } from "./display-math-lines.ts";

/** Keep literal markup as text, in a paragraph of its own when it is a block. */
export function htmlAsText() {
  return (tree: MdNode) => {
    function visit(node: MdNode): void {
      if (node.children === undefined) return;
      for (const [i, child] of node.children.entries()) {
        if (child.type === "html") {
          const text = { type: "text", value: child.value ?? "" };
          node.children[i] =
            node.type === "root" ||
            node.type === "blockquote" ||
            node.type === "listItem"
              ? { type: "paragraph", children: [text] }
              : text;
        } else {
          visit(child);
        }
      }
    }
    visit(tree);
  };
}
