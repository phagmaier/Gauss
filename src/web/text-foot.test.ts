import { expect, test } from "vitest";
import { textFoot } from "./text-foot.ts";

const foot = (text: string, saved: string, justSaved: boolean) =>
  textFoot(text, saved, justSaved, 2000);

test("the foot counts the text against the limit, and says whether it is saved and can be", () => {
  expect(foot("Works as a nurse.", "Works as a nurse.", false)).toEqual({
    count: "17 of 2,000 characters",
    over: false,
    changed: false,
    canSave: false,
    note: "",
  });
  expect(foot(" Works as a nurse.\n", "Works as a nurse.", true)).toEqual(
    expect.objectContaining({ changed: false, note: "Saved" }),
  );
  expect(foot("Works as a pharmacist.", "", true)).toEqual(
    expect.objectContaining({
      changed: true,
      canSave: true,
      note: "Not saved",
    }),
  );
  expect(foot("x".repeat(2000), "", false)).toEqual(
    expect.objectContaining({
      count: "2,000 of 2,000 characters",
      canSave: true,
    }),
  );
  expect(foot(`${"x".repeat(2001)}`, "", false)).toEqual({
    count: "2,001 of 2,000 characters",
    over: true,
    changed: true,
    canSave: false,
    note: "Too long to save",
  });
  expect(foot("  ", "Works as a nurse.", false)).toEqual(
    expect.objectContaining({ changed: true, canSave: false }),
  );
});

test("the foot counts against the limit it is given", () => {
  expect(textFoot("abcd", "", false, 3)).toEqual({
    count: "4 of 3 characters",
    over: true,
    changed: true,
    canSave: false,
    note: "Too long to save",
  });
});
