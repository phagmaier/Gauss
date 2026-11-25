import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import {
  fixedTeaching,
  gaussTeaching,
  splitTutorPrompt,
  TEACHING_END,
  TEACHING_START,
  tutorInstructions,
} from "./teaching.ts";

const tutorMd = await readFile(
  new URL("../../../prompts/tutor.md", import.meta.url),
  "utf8",
);

/** A tutor prompt shaped as tutor.md's "Default style" is. */
const PROMPT = [
  "# Rules",
  "",
  "Ask one question at a time.",
  "",
  "## Default style",
  "",
  TEACHING_START,
  "Plain and warm. Short",
  "paragraphs, one idea",
  "at a time.",
  TEACHING_END,
  "",
  "A course's style note adjusts",
  "this. It never lifts the limit.",
  "",
  "## Writing",
  "",
  "Write math in LaTeX.",
  "",
].join("\n");

test("unedited, tutor.md reaches the model as written, without its two marks", () => {
  const lines = tutorMd.split("\n");
  const unmarked = lines
    .filter((line) => line !== TEACHING_START && line !== TEACHING_END)
    .join("\n");
  expect(lines.length - unmarked.split("\n").length).toBe(2);

  const sent = tutorInstructions(splitTutorPrompt(tutorMd), undefined);

  expect(sent).toBe(unmarked);
  expect(sent).not.toContain("<!--");
});

test("the learner's text replaces only the paragraph between the marks", () => {
  const edit = "Use British spelling.\n\nPrefer a picture to a formula.";

  expect(tutorInstructions(splitTutorPrompt(PROMPT), `${edit}\n`)).toBe(
    [
      "# Rules",
      "",
      "Ask one question at a time.",
      "",
      "## Default style",
      "",
      "Use British spelling.",
      "",
      "Prefer a picture to a formula.",
      "",
      "A course's style note adjusts",
      "this. It never lifts the limit.",
      "",
      "## Writing",
      "",
      "Write math in LaTeX.",
      "",
    ].join("\n"),
  );
});

test("the page shows Gauss's paragraph and the fixed one after it with their lines joined", () => {
  const prompt = splitTutorPrompt(PROMPT);

  expect(gaussTeaching(prompt)).toBe(
    "Plain and warm. Short paragraphs, one idea at a time.",
  );
  expect(fixedTeaching(prompt)).toBe(
    "A course's style note adjusts this. It never lifts the limit.",
  );
});

test("a prompt without marks has nothing to edit and is sent whole; a mark alone, marks reversed, or marks not on lines of their own are refused", () => {
  const plain = "# Rules\n\nAsk one question at a time.\n";
  const prompt = splitTutorPrompt(plain);
  expect(prompt.shipped).toBeUndefined();
  expect(tutorInstructions(prompt, "Use British spelling.")).toBe(plain);

  const alone = PROMPT.replace(`${TEACHING_END}\n`, "");
  const reversed = PROMPT.replace(TEACHING_START, "@")
    .replace(TEACHING_END, TEACHING_START)
    .replace("@", TEACHING_END);
  const crlf = PROMPT.replaceAll("\n", "\r\n");
  const indented = PROMPT.replace(TEACHING_START, ` ${TEACHING_START}`).replace(
    TEACHING_END,
    ` ${TEACHING_END}`,
  );
  for (const text of [alone, reversed, crlf, indented]) {
    expect(() => splitTutorPrompt(text)).toThrow(/marks/);
  }
});
