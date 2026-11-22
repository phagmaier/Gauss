// Sources in the intake (piece 22), on the fake backend, with a converter
// that writes a source's files itself (fake-converter.ts): the conversion's
// own rules are tested in `pytools/tests/`, and the real converter in the
// sandbox is run by the route's upload test (`http/app-sources.test.ts`).

import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { PageEvent } from "../../shared/events.ts";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import { openDataRoot } from "../record/data-root.ts";
import { fakeConverter, upload } from "./fake-converter.ts";
import { createIntake, type Intake } from "./intake.ts";
import type { SourceConverter } from "./source-convert.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-intake-sources-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const HEGEL = "# Force and Understanding\n\nForce is the unity.\n";
const KANT = "# The Transcendental Aesthetic\n\nSpace is no concept.\n";

function setUp(
  script: FakeTurn[],
  converter: SourceConverter = fakeConverter(),
  extra: { sourceSizeLimit?: number } = {},
) {
  const backend = createFakeBackend(script);
  const dataRoot = openDataRoot({ path: dir });
  const intake = createIntake({
    backend,
    systemPrompt: "You are a test planner.",
    dataRoot,
    converter,
    ...extra,
  });
  return { backend, intake, dataRoot };
}

const PROPOSAL = {
  title: "Reading Hegel",
  units: [
    {
      id: "force",
      title: "Force",
      goal: "Say what Hegel means by force.",
      prerequisites: [],
    },
  ],
  style: "Close reading.",
  background: "Has read Kant.",
  profile: "Reads slowly.",
};

const OPENING: FakeTurn = [{ text: "What do you know of Hegel already?" }];
const PROPOSE: FakeTurn = [{ call: "propose_curriculum", input: PROPOSAL }];
const REPLY: FakeTurn = [{ text: "Noted." }];

function cards(intake: Intake) {
  return intake
    .events()
    .filter(
      (e) =>
        e.type === "source_converting" ||
        e.type === "source_attached" ||
        e.type === "source_refused" ||
        e.type === "source_removed",
    );
}

/** The body of a turn after its header: the blocks, then the learner's text. */
const bodyOf = (text: string | undefined) =>
  text?.slice(text.indexOf("]\n") + 2) ?? "";

/** The intake's upload folder's entries, hidden ones too. */
async function uploaded(intake: Intake): Promise<string[]> {
  const folder = join(dir, "uploads", intake.id);
  return existsSync(folder) ? (await readdir(folder)).sort() : [];
}

test("a file attached is converted into the intake's uploads, shown on its card, and its outline given to the planner's next turn, once", async () => {
  const { backend, intake } = setUp([OPENING, REPLY]);

  const attached = await intake.attach(upload("hegel.md", HEGEL));
  await intake.settled();

  expect(attached).toEqual({ ok: true, attachment: expect.any(String) });
  const attachment = attached.ok ? attached.attachment : "";
  expect(cards(intake)).toEqual([
    { type: "source_converting", attachment, name: "hegel.md", size: 47 },
    {
      type: "source_attached",
      attachment,
      size: 47,
      source: {
        id: "force-and-understanding",
        title: "Force and Understanding",
        name: "hegel.md",
        format: "markdown",
        sections: 1,
        cut: [],
      },
    },
  ]);
  // The scratch folder is gone; the source has its title's slug.
  expect(await uploaded(intake)).toEqual(["force-and-understanding"]);
  const outline = JSON.parse(
    await readFile(
      join(
        dir,
        "uploads",
        intake.id,
        "force-and-understanding",
        "outline.json",
      ),
      "utf8",
    ),
  );
  expect(outline.id).toBe("force-and-understanding");

  intake.say("I want to read this slowly.");
  await intake.settled();
  intake.say("Chapter III only.");
  await intake.settled();

  const first = backend.received[0]?.text ?? "";
  expect(first).toContain(
    "<sources> says what changed in the course's sources since you were last told: each source the learner attached, with its outline; each they removed; and each file that could not be attached.]\n",
  );
  expect(bodyOf(first)).toMatch(
    new RegExp(
      `</about_the_learner>\n\n${literally(`<sources>
Attached: "Force and Understanding" (source id "force-and-understanding"), a Markdown file, from the learner's file "hegel.md". Its outline, one line per entry, indented by depth: a heading's title, or a section's id, title, place and size in characters.
- "Force and Understanding"
  - s1: "Force and Understanding", paragraphs 1–2, 47 characters
</sources>

I want to read this slowly.`)}$`,
    ),
  );
  // Told once: the next turn has no sources' block.
  const second = backend.received[1]?.text ?? "";
  expect(second).not.toContain("<sources>");
  expect(bodyOf(second)).toBe("Chapter III only.");
});

test("a message sent while a file converts waits for it, so that its turn has the outline", async () => {
  const hold = Promise.withResolvers<void>();
  const { backend, intake } = setUp(
    [OPENING],
    fakeConverter({ hold: hold.promise }),
  );

  await intake.attach(upload("hegel.md", HEGEL));
  intake.say("Here is the book.");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(backend.received).toEqual([]);
  hold.resolve();
  await intake.settled();

  expect(backend.received[0]?.text).toContain(
    'Attached: "Force and Understanding"',
  );
});

test("approval waits while a file converts", async () => {
  const hold = Promise.withResolvers<void>();
  const { intake } = setUp(
    [OPENING, PROPOSE],
    fakeConverter({ hold: hold.promise }),
  );
  intake.say("Hegel, please.");
  await intake.settled();
  intake.say("Go ahead.");
  await intake.settled();

  void intake.attach(upload("hegel.md", HEGEL));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await intake.approve(1)).toEqual({
    ok: false,
    status: 409,
    error: "Wait until the file is converted: the planner has not seen it yet.",
  });
  hold.resolve();
  await intake.settled();
  expect(await intake.approve(1)).toEqual({ ok: true });
});

test("a source removed before the first proposal is deleted and the planner told; after the proposal, removal is refused and the move put the source in the course", async () => {
  const { backend, intake, dataRoot } = setUp([OPENING, PROPOSE]);
  const kant = await intake.attach(upload("kant.md", KANT));
  const hegel = await intake.attach(upload("hegel.md", HEGEL));
  await intake.settled();
  intake.say("Hegel, and some Kant.");
  await intake.settled();
  expect(await uploaded(intake)).toEqual([
    "force-and-understanding",
    "the-transcendental-aesthetic",
  ]);

  const removed = await intake.removeSource(kant.ok ? kant.attachment : "");

  expect(removed).toEqual({ ok: true });
  expect(cards(intake).at(-1)).toEqual({
    type: "source_removed",
    attachment: kant.ok ? kant.attachment : "",
  });
  expect(await uploaded(intake)).toEqual(["force-and-understanding"]);

  intake.say("Only Hegel after all. Go ahead.");
  await intake.settled();

  expect(bodyOf(backend.received[1]?.text)).toBe(
    '<sources>\nRemoved by the learner: "The Transcendental Aesthetic" (source id "the-transcendental-aesthetic"). It is not one of the course\'s sources.\n</sources>\n\nOnly Hegel after all. Go ahead.',
  );
  // The first proposal made the course and moved the source into it.
  expect(intake.courseId()).toBe("reading-hegel");
  expect(await uploaded(intake)).toEqual([]);
  const sources = await dataRoot.readSources("reading-hegel");
  expect(sources.map((s) => s.id)).toEqual(["force-and-understanding"]);
  expect(
    await readFile(
      join(
        dir,
        "courses/reading-hegel/sources/force-and-understanding/sections/s1.md",
      ),
      "utf8",
    ),
  ).toBe(HEGEL);

  expect(await intake.removeSource(hegel.ok ? hegel.attachment : "")).toEqual({
    ok: false,
    status: 409,
    error:
      "The first proposal has made the course, so the source stays with it.",
  });
  expect(await intake.removeSource("no-such-card")).toEqual({
    ok: false,
    status: 404,
    error: "No such source.",
  });
  expect(sources).toHaveLength(1);
});

test("a source attached after the first proposal goes into the course at once, and the planner's next turn is told of it alone", async () => {
  const { backend, intake, dataRoot } = setUp([OPENING, PROPOSE, REPLY]);
  await intake.attach(upload("hegel.md", HEGEL));
  intake.say("Hegel.");
  await intake.settled();
  intake.say("Go ahead.");
  await intake.settled();

  await intake.attach(upload("kant.md", KANT));
  await intake.settled();

  expect(await uploaded(intake)).toEqual([]);
  expect(
    (await dataRoot.readSources("reading-hegel")).map((s) => s.id),
  ).toEqual(["force-and-understanding", "the-transcendental-aesthetic"]);
  intake.say("Add the Kant to it.");
  await intake.settled();
  const body = bodyOf(backend.received[2]?.text);
  expect(body).toContain('Attached: "The Transcendental Aesthetic"');
  expect(body).not.toContain("Force and Understanding");
});

test("a reopened draft's intake tells its first turn of the course's sources", async () => {
  const first = setUp([OPENING, PROPOSE]);
  await first.intake.attach(upload("hegel.md", HEGEL));
  first.intake.say("Hegel.");
  await first.intake.settled();
  first.intake.say("Go ahead.");
  await first.intake.settled();
  await first.intake.close();

  // As after a restart: the draft is reviewed in a new intake.
  const stored = await first.dataRoot.readCourse("reading-hegel");
  const backend = createFakeBackend([REPLY]);
  const reopened = createIntake({
    backend,
    systemPrompt: "You are a test planner.",
    dataRoot: openDataRoot({ path: dir }),
    converter: fakeConverter(),
    draft: {
      id: "reading-hegel",
      proposal: {
        title: stored?.course.title ?? "",
        units: stored?.curriculum?.units ?? [],
      },
    },
  });
  reopened.say("Is the reading right?");
  await reopened.settled();

  expect(backend.received[0]?.text).toContain(
    'Attached: "Force and Understanding" (source id "force-and-understanding")',
  );
});

test.each([
  {
    name: "a conversion that fails",
    result: {
      result: "failed",
      reason: "it stopped with exit status 1: PdfiumError",
    },
    refusal: {
      reason: "failed",
      detail:
        "The conversion failed: it stopped with exit status 1: PdfiumError.",
    },
  },
  {
    name: "a conversion that runs out of time",
    result: { result: "timed-out", limit: "5 minutes" },
    refusal: {
      reason: "timed-out",
      detail: "The conversion took longer than 5 minutes, and was stopped.",
    },
  },
  {
    name: "a file the converter refuses",
    result: {
      result: "refused",
      reason: "scanned",
      detail:
        "Most of its pages have no text: it needs text recognition, which Gauss does not do.",
    },
    refusal: {
      reason: "scanned",
      detail:
        "Most of its pages have no text: it needs text recognition, which Gauss does not do.",
    },
  },
] as const)(
  "$name: the card shows why, nothing is kept, and the planner is told",
  async ({ result, refusal }) => {
    const { backend, intake } = setUp([OPENING], fakeConverter({ result }));

    const attached = await intake.attach(upload("hegel.pdf", "%PDF-1.7"));
    await intake.settled();

    const attachment = attached.ok ? attached.attachment : "";
    expect(cards(intake)).toEqual([
      { type: "source_converting", attachment, name: "hegel.pdf", size: 8 },
      {
        type: "source_refused",
        attachment,
        name: "hegel.pdf",
        size: 8,
        refusal,
      },
    ]);
    expect(await uploaded(intake)).toEqual([]);
    intake.say("Hegel.");
    await intake.settled();
    expect(bodyOf(backend.received[0]?.text)).toContain(
      `<sources>\nNot attached: the learner's file "hegel.pdf". ${refusal.detail} It is not one of the course's sources.\n</sources>\n\nHegel.`,
    );
    expect(await intake.removeSource(attachment)).toEqual({
      ok: false,
      status: 409,
      error: "That file is not attached.",
    });
  },
);

test("a file over the limit is refused from its stated size, unread, or once its bytes pass the limit; nothing is kept", async () => {
  const { intake } = setUp([], fakeConverter(), { sourceSizeLimit: 10 });

  const stated = await intake.attach(upload("big.md", HEGEL));
  const unstated = await intake.attach({
    name: "big.md",
    size: undefined,
    body: (async function* () {
      yield Buffer.from("# A\n\n");
      yield Buffer.from("more than ten bytes");
    })(),
  });

  expect(stated).toEqual({
    ok: false,
    status: 413,
    error: "It is 47 bytes; Gauss takes files up to 10 bytes.",
    attachment: expect.any(String),
  });
  expect(unstated).toMatchObject({
    ok: false,
    status: 413,
    error: "It is more than 10 bytes, the most Gauss takes.",
  });
  expect(cards(intake).map((e) => e.type)).toEqual([
    "source_refused",
    "source_converting",
    "source_refused",
  ]);
  expect(await uploaded(intake)).toEqual([]);
});

test("without a converter, attaching is refused with the reason, and a name that cannot be a file's is refused outright", async () => {
  const { intake } = setUp([], {
    unavailable: "bwrap is missing",
    convert: async () => ({ result: "failed", reason: "unused" }),
  });

  expect(await intake.attach(upload("hegel.md", HEGEL))).toMatchObject({
    ok: false,
    status: 409,
    error:
      "Gauss converts a source in its sandbox, which does not run here: bwrap is missing.",
  });
  expect(await intake.attach(upload("../hegel.md", HEGEL))).toEqual({
    ok: false,
    status: 400,
    error: "The file's name cannot hold a slash or a control character.",
  });
  expect(await intake.attach(upload("", HEGEL))).toEqual({
    ok: false,
    status: 400,
    error: "The file has no name.",
  });
  const refused = cards(intake) as Extract<
    PageEvent,
    { type: "source_refused" }
  >[];
  expect(refused.map((e) => e.refusal.reason)).toEqual(["sandbox"]);
  expect(await uploaded(intake)).toEqual([]);
});

/** A string as a regular expression that matches it alone. */
function literally(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
