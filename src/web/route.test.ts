import { expect, test } from "vitest";
import { parseRoute, paths } from "./route.ts";

test.each([
  ["/", { view: "library" }],
  ["/profile", { view: "profile" }],
  ["/profile/", { view: "profile" }],
  ["/profile/more", { view: "library" }],
  ["/settings", { view: "settings" }],
  ["/settings/", { view: "settings" }],
  ["/settings/more", { view: "library" }],
  ["/intakes/3eb7af09", { view: "intake", intakeId: "3eb7af09" }],
  ["/courses/linear-algebra/", { view: "course", courseId: "linear-algebra" }],
  ["/courses", { view: "library" }],
  ["/courses/linear-algebra/units", { view: "library" }],
  [
    "/courses/linear-algebra/units/vectors",
    { view: "unit", courseId: "linear-algebra", unitId: "vectors" },
  ],
  ["/courses/linear-algebra/units/vectors/more", { view: "library" }],
  [
    "/courses/linear-algebra/units/vectors/notes",
    { view: "notes", courseId: "linear-algebra", unitId: "vectors" },
  ],
  ["/courses/linear-algebra/units/vectors/notes/html", { view: "library" }],
  ["/courses/linear-algebra/units/%E0%A4/notes", { view: "library" }],
  [
    "/courses/linear-algebra/what-i-know",
    { view: "known", courseId: "linear-algebra" },
  ],
  [
    "/courses/linear-algebra/planning",
    { view: "planning", courseId: "linear-algebra" },
  ],
  ["/courses/linear-algebra/planning/more", { view: "library" }],
  ["/courses/linear-algebra/what-i-know/more", { view: "library" }],
  ["/intakes/3eb7af09/what-i-know", { view: "library" }],
  ["/courses/linear-algebra/units/%E0%A4", { view: "library" }],
  ["/intakes/3eb7af09/units/vectors", { view: "library" }],
  ["/elsewhere/x", { view: "library" }],
  ["/courses/%E0%A4", { view: "library" }],
  [
    "/courses/calculus/cheat-sheets/0b5f",
    { view: "cheatSheet", courseId: "calculus", sheetId: "0b5f" },
  ],
  ["/courses/calculus/cheat-sheets", { view: "library" }],
  ["/courses/calculus/cheat-sheets/0b5f/html", { view: "library" }],
  ["/courses/calculus/cheat-sheets/%E0%A4", { view: "library" }],
])("%s shows %o", (path, route) => {
  expect(parseRoute(path)).toEqual(route);
});

test("the paths the page makes lead back to their views", () => {
  expect(parseRoute(paths.course("linear-algebra"))).toEqual({
    view: "course",
    courseId: "linear-algebra",
  });
  expect(parseRoute(paths.intake("a b/c"))).toEqual({
    view: "intake",
    intakeId: "a b/c",
  });
  expect(parseRoute(paths.known("a b/c"))).toEqual({
    view: "known",
    courseId: "a b/c",
  });
  expect(parseRoute(paths.unit("linear-algebra", "a b/c"))).toEqual({
    view: "unit",
    courseId: "linear-algebra",
    unitId: "a b/c",
  });
  expect(paths.notes("a/b", "x y")).toBe("/courses/a%2Fb/units/x%20y/notes");
  expect(parseRoute(paths.notes("a/b", "x y"))).toEqual({
    view: "notes",
    courseId: "a/b",
    unitId: "x y",
  });
  expect(parseRoute(paths.cheatSheet("a/b", "x y"))).toEqual({
    view: "cheatSheet",
    courseId: "a/b",
    sheetId: "x y",
  });
});
