// "Quote" (piece 19): a passage selected in the tutor's text or a question's
// prompt, as the Markdown it was written in, for the message box. KaTeX sets
// each formula twice, as MathML and as HTML, so a selection's plain text
// reads it doubled; the formula's source is in the MathML's TeX annotation.
// A selection that starts or ends inside a formula takes the whole formula.

/** Where a selection can be quoted from: the tutor's text and a question's prompt. */
const QUOTABLE = ".th-tutor, .qa-prompt";

/** The selection's range, when it lies within one tutor's text or prompt and holds text. */
export function quotableRange(selection: Selection | null): Range | undefined {
  if (selection === null || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (range.collapsed || range.toString().trim() === "") return undefined;
  const block = elementOf(range.startContainer)?.closest(QUOTABLE);
  return block?.contains(range.endContainer) === true ? range : undefined;
}

/** A quotable range as Markdown with math as its TeX between dollars. */
export function passageSource(range: Range): string {
  const whole = range.cloneRange();
  const startMath = formulaAround(whole.startContainer);
  if (startMath !== null) whole.setStartBefore(startMath);
  const endMath = formulaAround(whole.endContainer);
  if (endMath !== null) whole.setEndAfter(endMath);
  // Walk the original elements. cloneContents drops enclosing code, lists and
  // tables when both selection endpoints are inside them.
  const common = whole.commonAncestorContainer;
  const block = elementOf(common)?.closest(QUOTABLE);
  return childrenSource(block ?? common, whole);
}

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;
}

function formulaAround(node: Node): Element | null {
  const el = elementOf(node);
  return (
    el?.closest(".katex-display") ?? el?.closest(".katex, .katex-error") ?? null
  );
}

/** Elements that stand as paragraphs of their own. */
const PARAGRAPH = /^(?:P|DIV|H[1-6]|BLOCKQUOTE|HR)$/;

function childrenSource(parent: Node, range: Range, inCell = false): string {
  const out = passageWriter(inCell);
  writeNodes(parent, range, out);
  return out.done();
}

function writeNodes(parent: Node, range: Range, out: PassageWriter): void {
  for (const node of parent.childNodes) {
    if (!range.intersectsNode(node)) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      out.text(textSlice(node, range));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    if (el.classList.contains("katex-display")) {
      const source = tex(el);
      const fence = delimiter(source, "$", /\$+/g, 2);
      if (fence === "$$" && !/^\s|\s$|^\$|\$$|\n/.test(source)) {
        out.around(`$$${source}$$`, 1);
      } else {
        out.around(`${fence}\n${source}\n${fence}`, 2);
      }
    } else if (el.classList.contains("katex")) {
      out.verbatim(inlineMath(tex(el)));
    } else if (el.classList.contains("katex-error")) {
      out.verbatim(inlineMath(el.textContent ?? ""));
    } else if (el.tagName === "BR") {
      out.break(1);
    } else if (el.tagName === "OL" || el.tagName === "UL") {
      out.around(
        listSource(el, range),
        el.parentElement?.tagName === "LI" ? 1 : 2,
      );
    } else if (el.tagName === "TABLE") {
      out.around(tableSource(el as HTMLTableElement, range), 2);
    } else if (el.tagName === "PRE") {
      const source = selectedText(el, range).replace(/\n$/, "");
      const fence = delimiter(source, "`", /`+/g, 3);
      const language =
        Array.from(el.firstElementChild?.classList ?? [])
          .find((name) => name.startsWith("language-"))
          ?.slice("language-".length) ?? "";
      if (source !== "")
        out.around(`${fence}${language}\n${source}\n${fence}`, 2);
    } else if (el.tagName === "CODE") {
      const source = selectedText(el, range);
      if (source !== "") {
        const fence = delimiter(source, "`", /`+/g, 1);
        out.code(inlineSpan(source, fence));
      }
    } else {
      const paragraph = PARAGRAPH.test(el.tagName);
      if (paragraph) out.break(2);
      writeNodes(el, range, out);
      if (paragraph) out.break(2);
    }
  }
}

/** TeX as written, including significant spaces and line endings. */
function tex(el: Element): string {
  return (
    el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ??
    ""
  );
}

function inlineMath(source: string): string {
  // Two dollars on their own line mean display math in Prose.
  const fence = source.includes("$") ? delimiter(source, "$", /\$+/g, 3) : "$";
  return inlineSpan(source, fence);
}

function delimiter(
  source: string,
  mark: string,
  runs: RegExp,
  minimum: number,
): string {
  let length = minimum;
  for (const [run] of source.matchAll(runs)) {
    length = Math.max(length, run.length + 1);
  }
  return mark.repeat(length);
}

function inlineSpan(source: string, fence: string): string {
  // Markdown strips one space from each side if both sides are padded.
  const pad =
    source.startsWith(fence[0] ?? "") ||
    source.endsWith(fence[0] ?? "") ||
    (source.startsWith(" ") && source.endsWith(" ") && source.trim() !== "")
      ? " "
      : "";
  return `${fence}${pad}${source}${pad}${fence}`;
}

function textSlice(node: Node, range: Range): string {
  return (node.nodeValue ?? "").slice(
    node === range.startContainer ? range.startOffset : 0,
    node === range.endContainer ? range.endOffset : undefined,
  );
}

/** Code should not go through the prose writer's whitespace handling. */
function selectedText(node: Node, range: Range): string {
  if (!range.intersectsNode(node)) return "";
  if (node.nodeType === Node.TEXT_NODE) return textSlice(node, range);
  let text = "";
  for (const child of node.childNodes) text += selectedText(child, range);
  return text;
}

function listSource(list: HTMLElement, range: Range): string {
  const ordered = list.tagName === "OL";
  let number = Number(list.getAttribute("start") ?? 1);
  const items: string[] = [];
  for (const item of list.children) {
    const marker = ordered ? `${number++}. ` : "- ";
    if (!range.intersectsNode(item)) continue;
    const text = childrenSource(item, range);
    if (text === "") continue;
    const indent = " ".repeat(marker.length);
    items.push(marker + text.replace(/\n(?=[^\n])/g, `\n${indent}`));
  }
  return items.join("\n");
}

function tableSource(table: HTMLTableElement, range: Range): string {
  let first = Infinity;
  let last = -1;
  let heading: string[] | undefined;
  const rows: string[][] = [];
  for (const row of table.rows) {
    if (!range.intersectsNode(row)) continue;
    const cells: string[] = [];
    for (const cell of row.cells) {
      if (!range.intersectsNode(cell)) continue;
      first = Math.min(first, cell.cellIndex);
      last = Math.max(last, cell.cellIndex);
      cells[cell.cellIndex] = childrenSource(cell, range, true);
    }
    if (row.parentElement === table.tHead) heading = cells;
    else rows.push(cells);
  }
  if (last === -1) return "";
  const columns = last - first + 1;
  const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
  const selectedLine = (cells: readonly string[]) =>
    line(Array.from({ length: columns }, (_, i) => cells[first + i] ?? ""));
  // GFM needs a header even when the selection contains only body cells.
  return [
    selectedLine(heading ?? []),
    line(Array<string>(columns).fill("---")),
    ...rows.map(selectedLine),
  ].join("\n");
}

type PassageWriter = ReturnType<typeof passageWriter>;

function passageWriter(inCell: boolean) {
  let out = "";
  let breaks = 0;
  let space = false;
  function verbatim(text: string) {
    if (text === "") return;
    if (out !== "") out += breaks ? "\n".repeat(breaks) : space ? " " : "";
    out += text;
    breaks = 0;
    space = false;
  }
  function breakBefore(lines: number) {
    breaks = Math.max(breaks, lines);
  }
  return {
    text(value: string) {
      const text = value.replace(/\s+/g, " ");
      space ||= text.startsWith(" ");
      const body = text.trim();
      verbatim(inCell ? body.replace(/[\\|]/g, "\\$&") : body);
      space ||= text.endsWith(" ");
    },
    verbatim,
    // GFM removes the table escape inside code spans, but not inside
    // math spans. TeX from this cell already uses an escaped pipe.
    code(text: string) {
      verbatim(inCell ? text.replaceAll("|", "\\|") : text);
    },
    break: breakBefore,
    around(text: string, lines: number) {
      if (text === "") return;
      breakBefore(lines);
      verbatim(text);
      breakBefore(lines);
    },
    done: () => out,
  };
}
