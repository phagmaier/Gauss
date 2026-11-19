import { describe, expect, test } from "vitest";
import { compareProfiles, sentences } from "./profile.ts";

describe("sentences", () => {
  test("cut after a sentence's end that a space follows, a closing quote or bracket going with it, and at every line break", () => {
    expect(
      sentences(
        'Knows calculus. Asked "why?" Likes proofs (short ones.) Uses v3.5 daily!\nNo end\n\n  Spaced   out.  ',
      ),
    ).toEqual([
      "Knows calculus.",
      'Asked "why?"',
      "Likes proofs (short ones.)",
      "Uses v3.5 daily!",
      "No end",
      "Spaced out.",
    ]);
    expect(sentences(" \n ")).toEqual([]);
  });
});

describe("compareProfiles", () => {
  // Piece 18's example (docs/prototype/18-profile.html): two sentences new,
  // one dropped, the rest kept.
  const WAS =
    "Works as a data analyst and writes Python every day. Knows single-variable calculus through integration. " +
    "Likes a picture or a worked example before the algebra, and short explanations. Would rather be asked why than only to compute.";
  const NOW =
    "Works as a data analyst and writes Python every day. Knows single-variable calculus through integration. " +
    "Can multiply matrices, but has had no linear algebra beyond that. " +
    "Likes a picture or a worked example before the algebra, and short explanations. " +
    "Would rather be asked to predict and explain than to compute by hand.";

  test("marks each new sentence and lists each dropped one, in order", () => {
    expect(compareProfiles(WAS, NOW)).toEqual({
      sentences: [
        {
          text: "Works as a data analyst and writes Python every day.",
          added: false,
        },
        {
          text: "Knows single-variable calculus through integration.",
          added: false,
        },
        {
          text: "Can multiply matrices, but has had no linear algebra beyond that.",
          added: true,
        },
        {
          text: "Likes a picture or a worked example before the algebra, and short explanations.",
          added: false,
        },
        {
          text: "Would rather be asked to predict and explain than to compute by hand.",
          added: true,
        },
      ],
      dropped: ["Would rather be asked why than only to compute."],
      changed: true,
    });
  });

  test("is not changed by spacing or line breaks between sentences, and is by their order", () => {
    const spaced = compareProfiles("One.  Two.", "One.\nTwo. ");
    expect(spaced.changed).toBe(false);
    expect(spaced.dropped).toEqual([]);
    expect(spaced.sentences.every((s) => !s.added)).toBe(true);

    const reordered = compareProfiles("One. Two.", "Two. One.");
    expect(reordered).toMatchObject({ dropped: [], changed: true });
    expect(reordered.sentences.every((s) => !s.added)).toBe(true);
  });

  test("counts a repeated sentence as often as it is there", () => {
    expect(compareProfiles("Same. Same.", "Same. Other.")).toEqual({
      sentences: [
        { text: "Same.", added: false },
        { text: "Other.", added: true },
      ],
      dropped: ["Same."],
      changed: true,
    });
  });
});
