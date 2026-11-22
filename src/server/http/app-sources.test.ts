// The routes of a source attached in the intake (piece 22). The upload runs
// the real converter in the engine's sandbox on the locked `pytools`
// environment, so these tests need what the sandbox needs and fail, rather
// than skip, where it cannot run. `engine/intake-sources.test.ts` covers the
// intake's handling of sources on a converter of its own.

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import { FILE_NAME_HEADER, type PageEvent } from "../../shared/events.ts";
import { Outline } from "../../shared/source.ts";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import { createCoursePlannings } from "../engine/course-planning.ts";
import { createDisputeJudge } from "../engine/dispute-judge.ts";
import { createDisputes } from "../engine/disputes.ts";
import { createGrader } from "../engine/grading.ts";
import { createHelpJudge } from "../engine/help-judge.ts";
import { createIntakes } from "../engine/intake.ts";
import { createNotes } from "../engine/notes.ts";
import { type Sandbox, startSandbox } from "../engine/sandbox.ts";
import { createSourceConverter } from "../engine/source-convert.ts";
import { createUnitChats } from "../engine/unit-chat.ts";
import { createUnitPlanner } from "../engine/unit-planning.ts";
import type { FileOpener } from "../open-file.ts";
import { openDataRoot } from "../record/data-root.ts";
import { createApp } from "./app.ts";

let sandbox: Extract<Sandbox, { available: true }>;
/** The sandbox's data root, closed to its reads; each test's lies inside it. */
let closed: string;
let dir: string;

beforeAll(async () => {
  closed = await mkdtemp(join(tmpdir(), "gauss-route-sources-"));
  const started = await startSandbox({ log: () => {}, dataRoot: closed });
  if (!started.available) {
    throw new Error(`These tests need the sandbox: ${started.reason}`);
  }
  sandbox = started;
});
afterAll(async () => {
  await sandbox?.close();
  await rm(closed, { recursive: true, force: true });
});
// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
beforeEach(async () => {
  dir = await mkdtemp(join(closed, "root-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const ORIGIN = "http://localhost";

function setUp(script: FakeTurn[] = []) {
  const backend = createFakeBackend(script);
  const dataRoot = openDataRoot({ path: dir });
  const intakes = createIntakes({
    backend,
    systemPrompt: "You are a test planner.",
    dataRoot,
    converter: createSourceConverter({ sandbox }),
  });
  const units = createUnitChats({
    backend,
    systemPrompt: "You are a test tutor.",
    dataRoot,
    planner: createUnitPlanner({ backend, systemPrompt: "Plan.", dataRoot }),
    grader: createGrader({ backend, systemPrompt: "Grade." }),
    judge: createHelpJudge({
      backend: createFakeBackend([]),
      systemPrompt: "Judge.",
    }),
  });
  const app = createApp({
    dataRoot,
    intakes,
    plannings: createCoursePlannings({
      backend,
      systemPrompt: "Plan the course.",
      dataRoot,
      units,
    }),
    units,
    disputes: createDisputes({
      dataRoot,
      units,
      judge: createDisputeJudge({
        backend: createFakeBackend([]),
        systemPrompt: "Decide.",
      }),
    }),
    notes: createNotes({
      dataRoot,
      backend: createFakeBackend([]),
      systemPrompt: "Write.",
      ready: async () => {},
    }),
    openFile: vi.fn<FileOpener>(async () => ({ ok: true })),
  });
  return { app, intakes, dataRoot };
}

type Setup = ReturnType<typeof setUp>;

async function startIntake({ app }: Setup): Promise<string> {
  const response = await app.request("/api/intakes", {
    method: "POST",
    headers: { Origin: ORIGIN },
  });
  const { intakeId } = (await response.json()) as { intakeId: string };
  return intakeId;
}

/** Posts a file as the page does: the body is the file, its name in a header. */
function attach(
  { app }: Setup,
  intakeId: string,
  name: string | undefined,
  body: string,
  headers: Record<string, string> = {},
) {
  return app.request(`/api/intakes/${intakeId}/sources`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      ...(name === undefined
        ? {}
        : { [FILE_NAME_HEADER]: encodeURIComponent(name) }),
      ...headers,
    },
    body,
  });
}

function events(setup: Setup, intakeId: string): PageEvent[] {
  return [...(setup.intakes.get(intakeId)?.events() ?? [])];
}

const NOTES = `# Résumé of the Preface

The true is the whole.

## Substance as subject

Everything turns on grasping the true not only as substance.
`;

test("an upload is converted by the real converter in the sandbox, put in the intake's uploads under its title's slug, and shown on its card", async () => {
  const setup = setUp();
  const intakeId = await startIntake(setup);
  const bytes = Buffer.byteLength(NOTES);

  const response = await attach(setup, intakeId, "Hegel – Preface.md", NOTES, {
    "Content-Length": String(bytes),
  });

  expect(response.status).toBe(202);
  const { attachment } = (await response.json()) as { attachment: string };
  await setup.intakes.get(intakeId)?.settled();
  const cards = events(setup, intakeId).filter((e) =>
    e.type.startsWith("source_"),
  );
  expect(cards).toEqual([
    {
      type: "source_converting",
      attachment,
      name: "Hegel – Preface.md",
      size: bytes,
    },
    {
      type: "source_attached",
      attachment,
      size: bytes,
      source: {
        id: "resume-of-the-preface",
        title: "Résumé of the Preface",
        name: "Hegel – Preface.md",
        format: "markdown",
        sections: 2,
        cut: [],
      },
    },
  ]);
  // Only the source's folder is left: the scratch folder is gone.
  const uploads = join(dir, "uploads", intakeId);
  expect(await readdir(uploads)).toEqual(["resume-of-the-preface"]);
  const folder = join(uploads, "resume-of-the-preface");
  const outline = Outline.parse(
    JSON.parse(await readFile(join(folder, "outline.json"), "utf8")),
  );
  expect(outline.id).toBe("resume-of-the-preface");
  expect(outline.name).toBe("Hegel – Preface.md");
  expect(await readFile(join(folder, "sections", "s1.md"), "utf8")).toBe(
    "# Résumé of the Preface\n\nThe true is the whole.\n\n",
  );
  expect(await readFile(join(folder, "sections", "s2.md"), "utf8")).toBe(
    "## Substance as subject\n\nEverything turns on grasping the true not only as substance.\n",
  );
  expect(await readFile(join(folder, "original.md"), "utf8")).toBe(NOTES);
});

test("a file of a format Gauss does not read is refused by the converter, and its card says why", async () => {
  const setup = setUp();
  const intakeId = await startIntake(setup);

  const response = await attach(
    setup,
    intakeId,
    "seminar.docx",
    "PK\u0003\u0004 not an EPUB",
  );

  expect(response.status).toBe(202);
  await setup.intakes.get(intakeId)?.settled();
  expect(events(setup, intakeId).at(-1)).toMatchObject({
    type: "source_refused",
    name: "seminar.docx",
    refusal: {
      reason: "format",
      detail: "Only PDF, EPUB, .txt, .md and .markdown files are supported.",
    },
  });
  expect(await readdir(join(dir, "uploads", intakeId))).toEqual([]);
});

test("a body over the limit is refused as too large before it is read, and the card shows it", async () => {
  const setup = setUp();
  const intakeId = await startIntake(setup);
  const size = 212 * 1024 * 1024;

  const response = await attach(setup, intakeId, "werke.pdf", "%PDF-", {
    "Content-Length": String(size),
  });

  expect(response.status).toBe(413);
  const answer = (await response.json()) as {
    error: string;
    attachment: string;
  };
  expect(answer.error).toBe("It is 212 MB; Gauss takes files up to 100 MB.");
  expect(events(setup, intakeId)).toEqual([
    {
      type: "source_refused",
      attachment: answer.attachment,
      name: "werke.pdf",
      size,
      refusal: { reason: "large", detail: answer.error },
    },
  ]);
});

test("removing a source: refused while unknown, done before the first proposal, and the route answers 404 for an intake that is gone", async () => {
  const setup = setUp();
  const intakeId = await startIntake(setup);
  const response = await attach(setup, intakeId, "notes.md", NOTES);
  const { attachment } = (await response.json()) as { attachment: string };
  await setup.intakes.get(intakeId)?.settled();
  const remove = (intake: string, card: string) =>
    setup.app.request(`/api/intakes/${intake}/sources/${card}/remove`, {
      method: "POST",
      headers: { Origin: ORIGIN },
    });

  expect((await remove(intakeId, "no-such-card")).status).toBe(404);
  const removed = await remove(intakeId, attachment);
  expect(removed.status).toBe(200);
  expect(events(setup, intakeId).at(-1)).toEqual({
    type: "source_removed",
    attachment,
  });
  expect(await readdir(join(dir, "uploads", intakeId))).toEqual([]);
  expect((await remove("gone", attachment)).status).toBe(404);
});

test("a file with no name, or a name that does not decode, is refused with no card", async () => {
  const setup = setUp();
  const intakeId = await startIntake(setup);

  const unnamed = await attach(setup, intakeId, undefined, NOTES);
  const garbled = await attach(setup, intakeId, undefined, NOTES, {
    [FILE_NAME_HEADER]: "%E0%A4%A",
  });

  expect([unnamed.status, garbled.status]).toEqual([400, 400]);
  expect(await garbled.json()).toEqual({
    error: "The file's name could not be read.",
  });
  expect(events(setup, intakeId)).toEqual([]);
});
