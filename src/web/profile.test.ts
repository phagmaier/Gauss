import { expect, test } from "vitest";
import { profileFoot } from "./profile.ts";

test("the foot counts the text against the limit, and says whether it is saved and can be", () => {
  expect(profileFoot("Works as a nurse.", "Works as a nurse.", false)).toEqual({
    count: "17 of 2,000 characters",
    over: false,
    changed: false,
    canSave: false,
    note: "",
  });
  expect(
    profileFoot(" Works as a nurse.\n", "Works as a nurse.", true),
  ).toEqual(expect.objectContaining({ changed: false, note: "Saved" }));
  expect(profileFoot("Works as a pharmacist.", "", true)).toEqual(
    expect.objectContaining({
      changed: true,
      canSave: true,
      note: "Not saved",
    }),
  );
  expect(profileFoot("x".repeat(2000), "", false)).toEqual(
    expect.objectContaining({
      count: "2,000 of 2,000 characters",
      canSave: true,
    }),
  );
  expect(profileFoot(`${"x".repeat(2001)}`, "", false)).toEqual({
    count: "2,001 of 2,000 characters",
    over: true,
    changed: true,
    canSave: false,
    note: "Too long to save",
  });
  expect(profileFoot("  ", "Works as a nurse.", false)).toEqual(
    expect.objectContaining({ changed: true, canSave: false }),
  );
});
