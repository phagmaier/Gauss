import { expect, test } from "vitest";
import { parseRoute, paths } from "./route.ts";

test.each([
  ["/", { view: "library" }],
  ["/intakes/3eb7af09", { view: "intake", intakeId: "3eb7af09" }],
  ["/courses/linear-algebra/", { view: "course", courseId: "linear-algebra" }],
  ["/courses", { view: "library" }],
  ["/courses/linear-algebra/units", { view: "library" }],
  ["/elsewhere/x", { view: "library" }],
  ["/courses/%E0%A4", { view: "library" }],
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
});
