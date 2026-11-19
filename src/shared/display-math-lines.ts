/** The parts of a Markdown syntax tree node that `displayMathLines` reads. */
export interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number | undefined } } | undefined;
  data?: { hProperties?: { className?: string[] } } | undefined;
}

/**
 * `$$...$$` on a line of its own is display math, as writers mean it, though
 * Markdown reads it as inline math unless the dollars are on lines of their
 * own. The newlines around it are dropped, since the formula is a block.
 */
export function displayMathLines() {
  return (tree: MdNode, file: { value: unknown }) => {
    const source = String(file.value);
    const startsLine = (node: MdNode | undefined) =>
      node === undefined ||
      node.type === "break" ||
      (node.type === "text" && node.value?.endsWith("\n") === true);
    const endsLine = (node: MdNode | undefined) =>
      node === undefined ||
      node.type === "break" ||
      (node.type === "text" && node.value?.startsWith("\n") === true);

    const visit = (node: MdNode): void => {
      const children = node.children ?? [];
      children.forEach(visit);
      if (node.type !== "paragraph") return;
      // Decide every formula before changing the text between them.
      const lines = children.filter((child, i) => {
        const at = child.position?.start.offset;
        return (
          child.type === "inlineMath" &&
          at !== undefined &&
          source.startsWith("$$", at) &&
          startsLine(children[i - 1]) &&
          endsLine(children[i + 1])
        );
      });
      for (const math of lines) {
        const i = children.indexOf(math);
        const before = children[i - 1];
        const after = children[i + 1];
        if (before?.type === "text" && before.value !== undefined)
          before.value = before.value.slice(0, -1);
        if (after?.type === "text" && after.value !== undefined)
          after.value = after.value.slice(1);
        math.data = {
          ...math.data,
          hProperties: {
            ...math.data?.hProperties,
            className: ["language-math", "math-display"],
          },
        };
      }
    };
    visit(tree);
  };
}
