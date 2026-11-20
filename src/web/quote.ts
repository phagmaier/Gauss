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

/** The passage a range covers, as Markdown with math as its TeX between dollars. */
export function passageSource(range: Range): string {
  const whole = range.cloneRange();
  const startMath = formulaAround(whole.startContainer);
  if (startMath !== null) whole.setStartBefore(startMath);
  const endMath = formulaAround(whole.endContainer);
  if (endMath !== null) whole.setEndAfter(endMath);
  const out = passageWriter();
  writeNodes(whole.cloneContents(), out);
  return out.done();
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
const PARAGRAPH = /^(?:P|DIV|H[1-6]|BLOCKQUOTE|UL|OL|TABLE|HR)$/;

function writeNodes(parent: Node, out: PassageWriter): void {
  for (const node of parent.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.text(node.nodeValue ?? "");
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    if (el.classList.contains("katex-display")) {
      out.lineBreak();
      out.text(`$$${tex(el)}$$`);
      out.lineBreak();
    } else if (el.classList.contains("katex")) {
      out.text(`$${tex(el)}$`);
    } else if (el.classList.contains("katex-error")) {
      out.text(`$${el.textContent ?? ""}$`);
    } else if (el.tagName === "BR" || el.tagName === "TR") {
      out.lineBreak();
      writeNodes(el, out);
    } else if (el.tagName === "LI") {
      out.lineBreak();
      out.item();
      writeNodes(el, out);
      out.lineBreak();
    } else if (el.tagName === "PRE") {
      out.paragraphBreak();
      out.verbatim(
        `\`\`\`\n${(el.textContent ?? "").replace(/\n$/, "")}\n\`\`\``,
      );
      out.paragraphBreak();
    } else if (el.tagName === "CODE") {
      out.text(`\`${el.textContent ?? ""}\``);
    } else if (el.tagName === "TD" || el.tagName === "TH") {
      writeNodes(el, out);
      out.text(" ");
    } else if (PARAGRAPH.test(el.tagName)) {
      out.paragraphBreak();
      writeNodes(el, out);
      out.paragraphBreak();
    } else {
      writeNodes(el, out);
    }
  }
}

/** A formula's TeX, its whitespace on one line. */
function tex(el: Element): string {
  const source = el.querySelector(
    'annotation[encoding="application/x-tex"]',
  )?.textContent;
  return (source ?? "").replace(/\s+/g, " ").trim();
}

interface PassageWriter {
  /** Text as the page shows it: its whitespace collapsed. */
  text(value: string): void;
  /** Text kept as it is, such as a code block. */
  verbatim(text: string): void;
  lineBreak(): void;
  paragraphBreak(): void;
  /** A list item's mark before the next text. */
  item(): void;
  done(): string;
}

/**
 * Text written out as Markdown lines. Text collapses its whitespace, as the
 * page shows it. A break is owed until text follows, so breaks in a row make
 * one and none starts or ends the passage; a list item's mark is owed the
 * same way, so a paragraph inside the item stays on the mark's line.
 */
function passageWriter(): PassageWriter {
  let out = "";
  /** The break owed before the next text: 0 none, 1 a new line, 2 a blank line. */
  let owed = 0;
  let mark = "";
  function put(text: string) {
    out += (out === "" ? "" : "\n".repeat(owed)) + mark + text;
    owed = 0;
    mark = "";
  }
  return {
    text(value: string) {
      let text = value.replace(/\s+/g, " ");
      if (out === "" || owed > 0 || mark !== "") text = text.trimStart();
      if (text !== "") put(text);
    },
    verbatim(text: string) {
      put(text);
    },
    lineBreak() {
      if (mark === "") owed = Math.max(owed, 1);
    },
    paragraphBreak() {
      if (mark === "") owed = 2;
    },
    item() {
      mark = "- ";
    },
    done(): string {
      return out.replace(/ +$/gm, "");
    },
  };
}
