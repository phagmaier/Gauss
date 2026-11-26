// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { CheatSheetList } from "../shared/cheat-sheet.ts";
import { CheatSheetsPanel, useCheatSheets } from "./CheatSheets.tsx";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

const UNITS = ["Functions", "Limits", "Continuity", "Derivatives", "Rules"].map(
  (title, at) => ({ id: `u${at + 1}`, title }),
);
const SHEET = {
  id: "0b5f2c5e-8f5a-4c1e-9a43-2f7d1c3e9b10",
  units: ["u1", "u2"],
  instructions: "",
  writtenAt: "2026-11-24T10:00:00.000Z",
  path: "/root/courses/calc/cheat-sheets/0b5f2c5e-8f5a-4c1e-9a43-2f7d1c3e9b10.html",
};
const NEWER = {
  ...SHEET,
  id: "7c1d9e2a-3b4f-4a6c-8d5e-1f2a3b4c5d6e",
  units: ["u2"],
  writtenAt: "2026-11-25T10:00:00.000Z",
  path: "/root/courses/calc/cheat-sheets/7c1d9e2a-3b4f-4a6c-8d5e-1f2a3b4c5d6e.html",
};

/** The server: answers the list it holds, and records each post. */
function serve(list: CheatSheetList) {
  const posts: { path: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push({
        path,
        body:
          init.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      if (path.endsWith("/delete")) {
        list = {
          ...list,
          sheets: list.sheets.filter((s) => !path.includes(`/${s.id}/`)),
        };
        return Response.json({ ok: true });
      }
      const { units, instructions } = JSON.parse(String(init.body));
      list = { ...list, attempt: { state: "writing", units, instructions } };
      return Response.json(list, { status: 202 });
    }
    return Response.json(list);
  });
  return posts;
}

/** The course view's use: the panel on the list the hook reads. */
function Harness() {
  const sheets = useCheatSheets("calc");
  return createElement(CheatSheetsPanel, {
    courseId: "calc",
    sheets,
    units: UNITS,
    onClose: () => {},
  });
}

async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  await act(async () => root.render(createElement(Harness)));
  // The hook reads the list on a timer of its own: let it run and answer.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  const button = (text: string) => {
    const found = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    );
    if (found === undefined) throw new Error(`No "${text}".`);
    return found;
  };
  const box = (label: string) => {
    const found = host.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    );
    if (found === null) throw new Error(`No box "${label}".`);
    return found;
  };
  return { host, button, box };
}

test("only finished units can be picked, and Write sends the picked in course order with the instructions", async () => {
  const posts = serve({ sheets: [], pickable: ["u1", "u2", "u3"] });
  const { host, button, box } = await mount();

  const boxes = [...host.querySelectorAll<HTMLInputElement>("input")];
  expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual([
    null,
    "Unit 1, Functions",
    "Unit 2, Limits",
    "Unit 3, Continuity",
  ]);
  expect(host.querySelector(".ch-all")?.textContent).toBe(
    "All finished units (3)",
  );
  expect(host.querySelector(".ch-not")?.textContent).toBe(
    "Units 4 and 5 are not finished, so they cannot be picked.",
  );
  const write = button("Write the cheat sheet");
  expect(write.disabled).toBe(true);
  expect(host.querySelector(".ch-sum")?.textContent).toBe(
    "Pick at least one unit.",
  );

  await act(async () => box("Unit 3, Continuity").click());
  await act(async () => box("Unit 1, Functions").click());
  expect(host.querySelector(".ch-sum")?.textContent).toBe(
    "Units 1 and 3: one printed page.",
  );
  const field = host.querySelector("textarea");
  if (field === null) throw new Error("No instructions box.");
  await act(async () => {
    // React reads the value through the prototype's setter.
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(field, "  One table of limits.  ");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => write.click());
  expect(posts).toEqual([
    {
      path: "/api/courses/calc/cheat-sheets",
      body: { units: ["u1", "u3"], instructions: "One table of limits." },
    },
  ]);
  // The write shows at the top, the form is cleared, and a second waits.
  expect(host.querySelector(".ch-list")?.textContent).toBe(
    "Units 1 and 3 Functions, ContinuityWriting the cheat sheet. This takes a minute; you can go on meanwhile.",
  );
  expect(field.value).toBe("");
  await act(async () => box("Unit 2, Limits").click());
  expect(button("Write the cheat sheet").disabled).toBe(true);
  expect(host.querySelector(".ch-sum")?.textContent).toBe(
    "One sheet is written at a time: write another once this one is done.",
  );
});

test("All finished units picks every finished unit, and picks none again", async () => {
  const posts = serve({ sheets: [], pickable: ["u1", "u2", "u4"] });
  const { host, button, box } = await mount();
  const all = host.querySelector<HTMLInputElement>(".ch-all input");
  await act(async () => all?.click());
  expect(
    ["Unit 1, Functions", "Unit 2, Limits", "Unit 4, Derivatives"].map(
      (label) => box(label).checked,
    ),
  ).toEqual([true, true, true]);
  await act(async () => all?.click());
  expect(box("Unit 2, Limits").checked).toBe(false);
  await act(async () => all?.click());
  await act(async () => button("Write the cheat sheet").click());
  expect(posts.at(-1)?.body).toEqual({
    units: ["u1", "u2", "u4"],
    instructions: "",
  });
});

test("a failed write says why, and Try again sends the same units and instructions", async () => {
  const posts = serve({
    sheets: [SHEET],
    attempt: {
      state: "failed",
      units: ["u2", "u3"],
      instructions: "Tables",
      error: "The cheat sheet writer took longer than three minutes.",
    },
    pickable: ["u1", "u2", "u3"],
  });
  const { host, button } = await mount();
  const rows = host.querySelectorAll(".ch-list > li");
  expect(rows[0]?.querySelector('[role="alert"]')?.textContent).toBe(
    "The cheat sheet could not be written. The cheat sheet writer took longer than three minutes.",
  );
  expect(rows[1]?.querySelector(".ch-u")?.textContent).toBe(
    "Units 1 and 2 Functions, Limits",
  );
  await act(async () => button("Try again").click());
  expect(posts).toEqual([
    {
      path: "/api/courses/calc/cheat-sheets",
      body: { units: ["u2", "u3"], instructions: "Tables" },
    },
  ]);
  expect(host.querySelector('.ch-list [role="status"]')?.textContent).toBe(
    "Writing the cheat sheet. This takes a minute; you can go on meanwhile.",
  );
});

test("Delete asks first, then removes that sheet from the list and keeps the other", async () => {
  const posts = serve({ sheets: [NEWER, SHEET], pickable: ["u1", "u2"] });
  const { host } = await mount();
  const row = (n: number) => host.querySelectorAll(".ch-row")[n];
  const inRow = (n: number, text: string) => {
    const found = [...(row(n)?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === text,
    );
    if (found === undefined) throw new Error(`No "${text}" in row ${n}.`);
    return found;
  };
  await act(async () => inRow(1, "Delete").click());
  expect(row(1)?.querySelector(".says")?.textContent).toBe(
    "Delete this cheat sheet? The app cannot bring it back.",
  );
  await act(async () => inRow(1, "Cancel").click());
  expect(host.querySelector(".ch-list .says")).toBeNull();
  expect(posts).toEqual([]);

  await act(async () => inRow(1, "Delete").click());
  await act(async () => inRow(1, "Delete the sheet").click());
  // The list is read again after the deletion.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(posts).toEqual([
    {
      path: `/api/courses/calc/cheat-sheets/${SHEET.id}/delete`,
      body: undefined,
    },
  ]);
  expect(
    [...host.querySelectorAll(".ch-row .ch-u")].map((u) => u.textContent),
  ).toEqual(["Unit 2 Limits"]);
  expect(host.querySelector(".ch-q > .st-k")?.textContent).toBe("A new sheet");
});
