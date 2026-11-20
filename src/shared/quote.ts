// A passage the learner quotes in a message (piece 19): Markdown quote lines,
// each starting `> `, which the page writes into the message box and shows,
// and the transcript export shows, as a quote. The tutor reads the message as
// sent.

/** A passage as a quote for the message box: each line `> `, then a blank line. */
export function asQuote(passage: string): string {
  const lines = passage
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`));
  return `${lines.join("\n")}\n\n`;
}

/** The message box's draft with the passage quoted after it. */
export function withQuote(draft: string, passage: string): string {
  const before = draft.trimEnd();
  return before === "" ? asQuote(passage) : `${before}\n\n${asQuote(passage)}`;
}

/** A run of a message's lines: quoted, without its `>` marks, or the learner's own. */
export interface MessagePart {
  quote: boolean;
  text: string;
}

const QUOTE_PREFIX = "> ";
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * The composer's `> ` runs as quotes, with plain text kept as typed except
 * for the blank lines separating the runs. Code fences in the learner's
 * own text protect their contents from quote recognition.
 */
export function messageParts(text: string): MessagePart[] {
  const lines = text.split("\n");
  const parts: MessagePart[] = [];
  let plainStart = 0;
  let fence: string | undefined;
  function addPlain(end: number) {
    const plain = lines
      .slice(plainStart, end)
      .join("\n")
      .replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, "");
    if (plain.trim() !== "") parts.push({ quote: false, text: plain });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const [, marker = "", rest = ""] = FENCE.exec(line) ?? [];
    if (fence !== undefined) {
      if (
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        /^[ \t]*$/.test(rest)
      ) {
        fence = undefined;
      }
      continue;
    }
    if (marker !== "" && (marker[0] === "~" || !rest.includes("`"))) {
      fence = marker;
      continue;
    }
    if (!line.startsWith(QUOTE_PREFIX) || line.slice(2).trim() === "") {
      continue;
    }

    let end = i + 1;
    while (lines[end] === ">" || lines[end]?.startsWith(QUOTE_PREFIX)) end++;
    // A bare marker separates paragraphs inside a quote, but on its own
    // is literal learner text.
    while (lines[end - 1] === ">") end--;
    addPlain(i);
    parts.push({
      quote: true,
      text: lines
        .slice(i, end)
        .map((quoted) => quoted.slice(2))
        .join("\n"),
    });
    plainStart = end;
    i = end - 1;
  }
  if (parts.length === 0) return [{ quote: false, text }];
  addPlain(lines.length);
  return parts;
}
