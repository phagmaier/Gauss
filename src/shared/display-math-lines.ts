/** The parts of a Markdown syntax tree node that `displayMathLines` reads. */
export interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number | undefined } } | undefined;
  data?: { hProperties?: { className?: string[] } } | undefined;
}

/**
 * A line with an inline span delimited by exactly two dollars means display
 * math. Longer inline delimiters can quote TeX containing dollar signs. The
 * newlines around a display span are dropped, since the formula is a block.
 * Markdown display fences on their own lines already render as display math.
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
          source[at + 2] !== "$" &&
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
