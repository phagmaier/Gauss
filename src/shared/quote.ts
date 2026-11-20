// A passage the learner quotes in a message (piece 19): Markdown quote lines,
// each starting `> `, which the page writes into the message box and shows,
// and the transcript export shows, as a quote. The tutor reads the message as
// sent.

/** A passage as a quote for the message box: each line `> `, then a blank line. */
export function asQuote(passage: string): string {
  const lines = passage.split("\n").map((line) => `> ${line}`.trimEnd());
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

const QUOTE_LINE = /^ {0,3}> ?/;

/**
 * A message as its quoted runs of lines and the learner's own text between
 * them, with the blank lines around each run dropped. A message with no
 * quote is one part, unchanged.
 */
export function messageParts(text: string): MessagePart[] {
  const lines = text.split("\n");
  if (!lines.some((line) => QUOTE_LINE.test(line))) {
    return [{ quote: false, text }];
  }
  const parts: MessagePart[] = [];
  for (const line of lines) {
    const quote = QUOTE_LINE.test(line);
    const last = parts.at(-1);
    const content = quote ? line.replace(QUOTE_LINE, "") : line;
    if (last?.quote === quote) last.text += `\n${content}`;
    else parts.push({ quote, text: content });
  }
  return parts
    .map((part) => ({
      quote: part.quote,
      text: part.text.replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, ""),
    }))
    .filter((part) => part.text.trim() !== "");
}
