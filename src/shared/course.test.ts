import { describe, expect, test } from "vitest";
import { Course, Slug } from "./course.ts";

// A hand-written course.json.
const COURSE = {
  title: "Calculus I",
  backend: "claude",
  settings: { webSearch: false },
  createdAt: "2026-11-15T09:00:00.000Z",
  lastOpenedAt: "2026-11-15T17:45:12.250Z",
};

test("a hand-written course parses unchanged", () => {
  expect(Course.parse(COURSE)).toEqual(COURSE);
});

describe("rejects", () => {
  test.each([
    {
      name: "a blank title",
      input: { ...COURSE, title: "  " },
      path: ["title"],
    },
    {
      name: "a backend Gauss does not have",
      input: { ...COURSE, backend: "gemini" },
      path: ["backend"],
    },
    {
      name: "a date with no time zone",
      input: { ...COURSE, createdAt: "2026-11-15T09:00:00" },
      path: ["createdAt"],
    },
    {
      name: "missing settings",
      input: { ...COURSE, settings: undefined },
      path: ["settings"],
    },
  ])("$name", ({ input, path }) => {
    const result = Course.safeParse(input);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path }),
    );
  });
});

// Course and unit ids name folders under the data root, so a valid id must
// stay one plain folder name.
test.each(["calculus-1", "a", "phenomenology-of-spirit", "2026"])(
  "%j is an id",
  (id) => {
    expect(Slug.safeParse(id).success).toBe(true);
  },
);

test.each([
  "",
  "Calculus",
  "calculus i",
  "../courses",
  "a/b",
  ".",
  "-limits",
  "limits-",
  "chain--rule",
  "x".repeat(61),
])("%j is not an id", (id) => {
  expect(Slug.safeParse(id).success).toBe(false);
});
