// Sources in the intake (piece 22), on the fake backend, with a converter
// that writes a source's files itself (fake-converter.ts): the conversion's
// own rules are tested in `pytools/tests/`, and the real converter in the
// sandbox is run by the route's upload test (`http/app-sources.test.ts`).

import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { PageEvent } from "../../shared/events.ts";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
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
  extra: { sourceSizeLimit?: number; dataRoot?: DataRoot } = {},
) {
  const backend = createFakeBackend(script);
  const { dataRoot = openDataRoot({ path: dir }), ...limits } = extra;
  const intake = createIntake({
    backend,
    systemPrompt: "You are a test planner.",
    dataRoot,
    converter,
    ...limits,
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

/** Waits until this file's result has reached the source placement queue. */
function watchConversion(name: string) {
  const ready = Promise.withResolvers<void>();
  const base = fakeConverter();
  const converter: SourceConverter = {
    ...base,
    async convert(original, folder) {
      const result = await base.convert(original, folder);
      if (basename(original) === name) ready.resolve();
      return result;
    },
  };
  return {
    converter,
    async queued() {
      await ready.promise;
      await setImmediate();
    },
  };
}

test("the first proposal keeps its sources stable while the course is made, even with a removal and a new upload queued", async () => {
  const record = openDataRoot({ path: dir });
  const created = Promise.withResolvers<void>();
  const finishCreating = Promise.withResolvers<void>();
  const reading = {
    ...PROPOSAL,
    units: PROPOSAL.units.map((unit) => ({
      ...unit,
      sections: ["the-transcendental-aesthetic/s1"],
    })),
  };
  const conversion = watchConversion("second.md");
  const { intake } = setUp(
    [OPENING, [{ call: "propose_curriculum", input: reading }]],
    conversion.converter,
    {
      dataRoot: {
        ...record,
        async createCourse(options) {
          const course = await record.createCourse(options);
          created.resolve();
          await finishCreating.promise;
          return course;
        },
      },
    },
  );

  await intake.attach(upload("first.md", HEGEL));
  const disposable = await intake.attach(upload("kant.md", KANT));
  if (!disposable.ok) throw new Error(disposable.error);
  intake.say("Hegel.");
  await intake.settled();
  intake.say("Go ahead.");
  await created.promise;
  const remove = intake.removeSource(disposable.attachment);
  try {
    await intake.attach(upload("second.md", HEGEL));
    await conversion.queued();
  } finally {
    finishCreating.resolve();
  }
  expect(await remove).toMatchObject({ ok: false, status: 409 });
  await intake.settled();

  expect(intake.events()).toContainEqual(
    expect.objectContaining({ type: "curriculum_proposed", revision: 1 }),
  );
  expect(
    (await record.readSources("reading-hegel")).map((s) => s.name),
  ).toEqual(["first.md", "second.md", "kant.md"]);
  expect(await uploaded(intake)).toEqual([]);
});

test("a duplicate removal queued behind a replacement cannot delete the replacement", async () => {
  const record = openDataRoot({ path: dir });
  const removing = Promise.withResolvers<void>();
  const finishRemoving = Promise.withResolvers<void>();
  const conversion = watchConversion("second.md");
  const { intake } = setUp([], conversion.converter, {
    dataRoot: {
      ...record,
      async removeUpload(intakeId, sourceId) {
        removing.resolve();
        await finishRemoving.promise;
        return record.removeUpload(intakeId, sourceId);
      },
    },
  });
  const initial = await intake.attach(upload("first.md", HEGEL));
  if (!initial.ok) throw new Error(initial.error);
  await intake.settled();
  const remove = intake.removeSource(initial.attachment);
  await removing.promise;
  try {
    await intake.attach(upload("second.md", HEGEL));
    await conversion.queued();
    const stale = intake.removeSource(initial.attachment);
    finishRemoving.resolve();
    await remove;
    expect(await stale).toMatchObject({ ok: false, status: 409 });
  } finally {
    finishRemoving.resolve();
    await intake.settled();
  }

  const folder = join(dir, "uploads", intake.id, "force-and-understanding");
  expect(
    JSON.parse(await readFile(join(folder, "outline.json"), "utf8")),
  ).toMatchObject({ name: "second.md" });
});

test("the planner is told when a replacement reuses a slug it already saw", async () => {
  const { backend, intake } = setUp([OPENING, REPLY]);
  const initial = await intake.attach(upload("first.md", HEGEL));
  if (!initial.ok) throw new Error(initial.error);
  intake.say("Here is my source.");
  await intake.settled();
  await intake.removeSource(initial.attachment);
  await intake.attach(upload("second.md", `${HEGEL}\nA longer replacement.`));
  intake.say("Use this one instead.");
  await intake.settled();

  const sent = bodyOf(backend.received[1]?.text);
  expect(sent).toMatch(
    /Removed by the learner: .*force-and-understanding.*\n+Attached: .*force-and-understanding.*"second\.md"/,
  );
  expect(sent).toContain("69 characters");
});

test("a proposal cannot use a same-slug replacement until the planner receives its outline", async () => {
  const reading = {
    ...PROPOSAL,
    units: PROPOSAL.units.map((unit) => ({
      ...unit,
      sections: ["force-and-understanding/s1"],
    })),
  };
  const propose: FakeTurn = [{ call: "propose_curriculum", input: reading }];
  const fake = createFakeBackend([OPENING, propose, propose]);
  const entered = Promise.withResolvers<void>();
  const proceed = Promise.withResolvers<void>();
  const dataRoot = openDataRoot({ path: dir });
  const intake = createIntake({
    backend: {
      ...fake,
      startSession(options) {
        return fake.startSession({
          ...options,
          tools: options.tools.map((tool) => ({
            ...tool,
            async run(input) {
              entered.resolve();
              await proceed.promise;
              return tool.run(input);
            },
          })),
        });
      },
    },
    systemPrompt: "You are a test planner.",
    dataRoot,
    converter: fakeConverter(),
  });
  const initial = await intake.attach(upload("first.md", HEGEL));
  if (!initial.ok) throw new Error(initial.error);
  intake.say("Here is my source.");
  await intake.settled();
  intake.say("Go ahead.");
  await entered.promise;

  const placed = Promise.withResolvers<void>();
  const stop = intake.subscribe((event) => {
    if (event.type === "source_attached" && event.source.name === "second.md") {
      placed.resolve();
    }
  });
  try {
    expect(await intake.removeSource(initial.attachment)).toEqual({ ok: true });
    expect(
      await intake.attach(
        upload("second.md", `${HEGEL}\nA longer replacement.`),
      ),
    ).toMatchObject({ ok: true });
    await placed.promise;
  } finally {
    stop();
    proceed.resolve();
    await intake.settled();
  }

  expect(fake.calls[0]?.result).toMatchObject({
    status: "refused",
    text: expect.stringContaining('"force-and-understanding"'),
  });
  expect(await dataRoot.listCourses()).toEqual([]);

  intake.say("Use the replacement.");
  await intake.settled();
  expect(bodyOf(fake.received[2]?.text)).toContain('"second.md"');
  expect(fake.calls[1]?.result.status).toBe("done");
  expect(
    (await dataRoot.readCourse("reading-hegel"))?.curriculum?.units,
  ).toEqual(reading.units);
  expect(
    (await dataRoot.readSources("reading-hegel")).map((source) => source.name),
  ).toEqual(["second.md"]);
});

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
    renderPage: async () => ({ result: "failed", reason: "unused" }),
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

// Task 4.7: units name the sections they teach.
test("a proposal's units name the attached source's sections: the draft keeps them and the card shows them", async () => {
  const reading = {
    ...PROPOSAL,
    units: PROPOSAL.units.map((unit) => ({
      ...unit,
      sections: ["force-and-understanding/s1"],
    })),
  };
  const { intake, dataRoot } = setUp([
    OPENING,
    [{ call: "propose_curriculum", input: reading }],
  ]);

  await intake.attach(upload("hegel.md", HEGEL));
  intake.say("Hegel.");
  await intake.settled();
  intake.say("Go ahead.");
  await intake.settled();

  const stored = await dataRoot.readCourse("reading-hegel");
  expect(stored?.curriculum?.units).toEqual(reading.units);
  expect(
    intake.events().find((e) => e.type === "curriculum_proposed"),
  ).toMatchObject({ units: reading.units });
});

test("a proposal naming a section the sources lack, or a unit over 150,000 characters, is refused with the reason: a first one makes no course, and a revision leaves the draft as it was", async () => {
  // 9 + 149,990 + 1 characters: 150,000, the most a unit reads; with
  // Hegel's 47, over it.
  const whole = `# Whole\n\n${"a".repeat(149_990)}\n`;
  const reads = (sections: string[], title = PROPOSAL.title) => ({
    ...PROPOSAL,
    title,
    units: PROPOSAL.units.map((unit) => ({ ...unit, sections })),
  });
  const unknown = reads(["force-and-understanding/s2"], "Refused first");
  const { intake, dataRoot, backend } = setUp([
    OPENING,
    [
      { call: "propose_curriculum", input: unknown },
      {
        call: "propose_curriculum",
        input: reads(
          ["force-and-understanding/s1", "whole/s1"],
          "Refused second",
        ),
      },
      { call: "propose_curriculum", input: reads(["whole/s1"]) },
    ],
    [
      {
        call: "propose_curriculum",
        input: reads(["force-and-understanding/s2"]),
      },
    ],
  ]);
  const unknownRefusal = {
    status: "refused",
    text: 'Unit "force" names "force-and-understanding/s2", but "force-and-understanding" has no such section: its one section is s1.',
  };

  await intake.attach(upload("hegel.md", HEGEL));
  await intake.attach(upload("whole.md", whole));
  intake.say("Hegel.");
  await intake.settled();
  intake.say("Go ahead.");
  await intake.settled();

  expect(backend.calls.map((c) => c.result)).toEqual([
    unknownRefusal,
    {
      status: "refused",
      text: 'Unit "force" reads 150,047 characters, more than the 150,000 a unit can read. Split it into units that each read fewer sections.',
    },
    expect.objectContaining({ status: "done" }),
  ]);
  // Had a refused proposal made the course, it would bear that one's title.
  expect((await dataRoot.listCourses()).map((c) => c.id)).toEqual([
    "reading-hegel",
  ]);

  intake.say("Read the other part.");
  await intake.settled();

  expect(backend.calls.at(-1)?.result).toEqual(unknownRefusal);
  expect(
    (await dataRoot.readCourse("reading-hegel"))?.curriculum?.units,
  ).toEqual(reads(["whole/s1"]).units);
  expect(
    intake.events().filter((e) => e.type === "curriculum_proposed"),
  ).toHaveLength(1);
});

/** A string as a regular expression that matches it alone. */
function literally(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
