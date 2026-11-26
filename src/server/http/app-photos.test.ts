// Photos in a unit's messages, through the routes: staged by the real photo
// taker, which runs `pytools/photo.py` in the engine's sandbox, so these
// tests need what the sandbox needs and fail, rather than skip, where it
// cannot run. The tutor and the help judge are fake backends.

import { mkdtemp, readdir, rm } from "node:fs/promises";
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
import { PhotoStaged } from "../../shared/photo.ts";
import {
  createFakeBackend,
  type FakeReply,
  type FakeTurn,
  KeptSessions,
} from "../backends/fake.ts";
import { createCheatSheets } from "../engine/cheat-sheets.ts";
import { givenOrder } from "../engine/choice-order.ts";
import { createCoursePlannings } from "../engine/course-planning.ts";
import { createDisputeJudge } from "../engine/dispute-judge.ts";
import { createDisputes } from "../engine/disputes.ts";
import { createGrader } from "../engine/grading.ts";
import { createHelpJudge } from "../engine/help-judge.ts";
import { createIntakes } from "../engine/intake.ts";
import { createNotes } from "../engine/notes.ts";
import { createPhotoTaker } from "../engine/photos.ts";
import { type Sandbox, startSandbox } from "../engine/sandbox.ts";
import { createUnitChats } from "../engine/unit-chat.ts";
import { createUnitPlanner } from "../engine/unit-planning.ts";
import type { FileOpener } from "../open-file.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import { createApp } from "./app.ts";

let sandbox: Extract<Sandbox, { available: true }>;
/** The sandbox's data root, closed to its reads; each test's lies inside it. */
let closed: string;
let dir: string;

beforeAll(async () => {
  closed = await mkdtemp(join(tmpdir(), "gauss-route-photos-"));
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
const COURSE = "linear-algebra";
const UNIT = `/api/courses/${COURSE}/units/vectors`;
/** A 4 by 3 grey PNG and a 3 by 5 red one, made with Pillow. */
const GREY = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFElEQVR4nGM8ISfHAANMDEgAhQMAJtoBCkAAOw8AAAAASUVORK5CYII=",
  "base64",
);
const RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAAFCAIAAAAPE8H1AAAAF0lEQVR4nGM8ISfHwMDAwMDAxAAD+FkAMpYBDmz0pSwAAAAASUVORK5CYII=",
  "base64",
);
/** A photo id no message staged. */
const UNKNOWN = "0b7e1f9a-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
const NOT_STAGED =
  "A photo of this message is not waiting to be sent: attach it again.";
const QUESTION = {
  objective: "basis-image",
  kind: "choice",
  prompt: "Which vectors fix a linear map on $\\mathbb{R}^2$?",
  choices: ["The images of a basis", "The image of one vector"],
  answer: "A",
};

/** Holds the chat's keeping of photos until released, once it has begun. */
function keepingGate() {
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  return {
    entered: entered.promise,
    release: released.resolve,
    wrap: (root: DataRoot): DataRoot => ({
      ...root,
      async keepPhotos(id, photos) {
        entered.resolve();
        await released.promise;
        return root.keepPhotos(id, photos);
      },
    }),
  };
}

function setUp(
  script: FakeTurn[],
  rulings: FakeReply[] = [],
  kept = new KeptSessions(),
  gate?: ReturnType<typeof keepingGate>,
) {
  const backend = createFakeBackend(script, [], { kept });
  const judgeBackend = createFakeBackend([], rulings);
  const dataRoot = openDataRoot({ path: dir });
  const units = createUnitChats({
    backends: { claude: backend },
    systemPrompt: "You are a test tutor.",
    dataRoot: gate === undefined ? dataRoot : gate.wrap(dataRoot),
    planner: createUnitPlanner({
      backends: { claude: backend },
      systemPrompt: "Plan.",
      dataRoot,
    }),
    grader: createGrader({ backend, systemPrompt: "Grade." }),
    judge: createHelpJudge({ backend: judgeBackend, systemPrompt: "Judge." }),
    order: givenOrder,
  });
  const app = createApp({
    dataRoot,
    intakes: createIntakes({ backend, systemPrompt: "Plan.", dataRoot }),
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
    cheatSheets: createCheatSheets({
      dataRoot,
      backend: createFakeBackend([]),
      systemPrompt: "Write.",
      ready: async () => {},
    }),
    photos: createPhotoTaker({ sandbox, dataRoot }),
    openFile: vi.fn<FileOpener>(async () => ({ ok: true })),
  });
  return { app, backend, judgeBackend, dataRoot, units };
}

type Setup = ReturnType<typeof setUp>;

/** An approved course whose first unit is planned. */
async function approvedCourse() {
  const root = openDataRoot({ path: dir });
  const course = {
    title: "Linear algebra",
    units: [
      {
        id: "vectors",
        title: "Vectors and linear maps",
        goal: "Describe a linear map by what it does to a basis.",
        prerequisites: [],
      },
    ],
    style: "Short explanations.",
    background: "The learner can multiply matrices.",
  };
  const { id } = await root.createCourse({ title: course.title });
  await root.saveProposal(id, course);
  await root.approveCurriculum(id, course);
  await root.storePlan(id, "vectors", {
    objectives: [
      {
        id: "basis-image",
        statement: "Describe a linear map by the images of a basis.",
      },
    ],
    segments: [{ title: "Bases", objectives: ["basis-image"] }],
  });
}

function post(setup: Setup, path: string, body?: unknown) {
  return setup.app.request(`${UNIT}${path}`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function openUnit(setup: Setup) {
  expect((await post(setup, "/open")).status).toBe(200);
  await settle(setup);
}

async function settle(setup: Setup) {
  await setup.units.get(COURSE, "vectors")?.settled();
}

function events(setup: Setup): readonly PageEvent[] {
  return setup.units.get(COURSE, "vectors")?.events() ?? [];
}

function learnerEvents(setup: Setup) {
  return events(setup).filter((event) => event.type === "learner");
}

/** Attaches a photo as the page does: the body is the file, its name in a header. */
function attach(setup: Setup, bytes: Buffer, name: string) {
  return setup.app.request(`${UNIT}/photos`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      [FILE_NAME_HEADER]: encodeURIComponent(name),
      "Content-Length": String(bytes.length),
    },
    body: new Uint8Array(bytes),
  });
}

async function stage(setup: Setup, bytes: Buffer, name: string) {
  const response = await attach(setup, bytes, name);
  expect(response.status).toBe(200);
  return PhotoStaged.parse(await response.json()).photo;
}

async function staged(): Promise<string[]> {
  return (await readdir(join(dir, "uploads", "photos"))).sort();
}

/** The photos as the course keeps them, as a turn should carry them. */
async function kept(setup: Setup, photos: readonly string[]) {
  return Promise.all(
    photos.map(async (photo) => {
      const data = await setup.dataRoot.readPhoto(COURSE, photo);
      if (data === undefined) throw new Error(`${photo} is not kept.`);
      return { data, mimeType: "image/jpeg" };
    }),
  );
}

test("a message of two photos and no text logs one event naming both, and the tutor gets one turn with both images' bytes in order", async () => {
  const setup = setUp([
    [{ text: "A map is fixed by a basis." }],
    [{ text: "I see your working." }],
  ]);
  await approvedCourse();
  try {
    await openUnit(setup);
    const grey = await stage(setup, GREY, "grey.png");
    const red = await stage(setup, RED, "Red photo.png");
    expect(await staged()).toEqual([`${grey}.jpg`, `${red}.jpg`].sort());
    const from = events(setup).length;

    const sent = await post(setup, "/messages", {
      text: "",
      photos: [grey, red],
    });
    expect(sent.status).toBe(202);
    await settle(setup);

    expect(
      events(setup)
        .slice(from)
        .filter((event) => event.type === "learner"),
    ).toEqual([
      {
        type: "learner",
        id: expect.any(String),
        text: "",
        photos: [grey, red],
      },
    ]);
    expect(await staged()).toEqual([]);
    const images = await kept(setup, [grey, red]);
    // Each a JPEG of its own photo, so the order below is the photos'.
    for (const { data } of images) {
      expect(data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    }
    expect(images[0]?.data).not.toEqual(images[1]?.data);
    expect(setup.backend.received).toHaveLength(2);
    const turn = setup.backend.received[1];
    expect(turn?.images).toEqual(images);
    expect(turn?.learnerMessage).toBe("");
    expect(turn?.text).toContain(
      "Message from the learner, with 2 photos, given before this header.",
    );
  } finally {
    await setup.units.close();
  }
});

test("a message with a photo while a question is open is taken, and the help judge is told of the photo it cannot see", async () => {
  const setup = setUp(
    [
      [{ text: "A map is fixed by a basis." }],
      [{ call: "ask_question", input: QUESTION }],
      [{ text: "It asks which vectors decide the map." }],
    ],
    [{ output: { reason: "Only the wording.", verdict: "clarification" } }],
  );
  await approvedCourse();
  try {
    await openUnit(setup);
    expect((await post(setup, "/ready")).status).toBe(202);
    await settle(setup);
    const photo = await stage(setup, GREY, "working.png");

    const sent = await post(setup, "/messages", {
      text: "What does this ask?",
      photos: [photo],
    });
    expect(sent.status).toBe(202);
    await settle(setup);

    expect(learnerEvents(setup).at(-1)).toMatchObject({
      text: "What does this ask?",
      photos: [photo],
    });
    expect(setup.backend.received.at(-1)?.images).toEqual(
      await kept(setup, [photo]),
    );
    expect(setup.judgeBackend.oneShots).toHaveLength(1);
    expect(setup.judgeBackend.oneShots[0]?.prompt).toContain(
      "<message>\nWhat does this ask?\n</message>\n" +
        "The message had 1 photo, which you cannot see.\n\n<reply>\n" +
        "It asks which vectors decide the map.\n</reply>",
    );
    expect(events(setup).at(-1)).toMatchObject({
      type: "judged",
      number: 1,
      verdict: "clarification",
    });
  } finally {
    await setup.units.close();
  }
});

test("a photo not staged, a photo already sent and a fifth photo are each refused, and nothing is logged", async () => {
  const setup = setUp([
    [{ text: "A map is fixed by a basis." }],
    [{ text: "I see it." }],
  ]);
  await approvedCourse();
  try {
    await openUnit(setup);
    // A file that is not an image is refused when attached, with its reason.
    const notImage = await attach(
      setup,
      Buffer.from("Not a photo.\n"),
      "a.jpg",
    );
    expect(notImage.status).toBe(415);
    expect(await notImage.json()).toEqual({
      error: "It is not a JPEG, PNG or WebP image.",
    });

    const sentOnce = await stage(setup, GREY, "grey.png");
    expect(
      (await post(setup, "/messages", { text: "One.", photos: [sentOnce] }))
        .status,
    ).toBe(202);
    await settle(setup);
    const logged = learnerEvents(setup).length;
    const turns = setup.backend.received.length;

    for (const photos of [[UNKNOWN], [sentOnce]]) {
      const refused = await post(setup, "/messages", { text: "Two.", photos });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toEqual({ error: NOT_STAGED });
    }
    const five: string[] = [];
    for (let n = 0; n < 5; n += 1) five.push(await stage(setup, RED, "r.png"));
    const tooMany = await post(setup, "/messages", {
      text: "Five.",
      photos: five,
    });
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toEqual({
      error: "A message takes at most 4 photos.",
    });
    await settle(setup);

    expect(learnerEvents(setup)).toHaveLength(logged);
    expect(setup.backend.received).toHaveLength(turns);
    // The five are still staged, to be sent four at a time.
    expect(await staged()).toEqual(five.map((p) => `${p}.jpg`).sort());
  } finally {
    await setup.units.close();
  }
});

test("a message with photos queued behind a running turn keeps them when its turn runs", async () => {
  const setup = setUp([
    [{ text: "A map is fixed by a basis." }],
    [{ text: "Holding." }, { hold: true }],
    [{ text: "I see both." }],
  ]);
  await approvedCourse();
  try {
    await openUnit(setup);
    const [grey, red] = [
      await stage(setup, GREY, "grey.png"),
      await stage(setup, RED, "red.png"),
    ];
    const chat = setup.units.get(COURSE, "vectors");
    const holding = Promise.withResolvers<void>();
    const unsubscribe = chat?.subscribe((event) => {
      if (event.type === "tutor_text") holding.resolve();
    });
    expect((await post(setup, "/messages", { text: "Wait." })).status).toBe(
      202,
    );
    await holding.promise;
    unsubscribe?.();

    const queued = await post(setup, "/messages", {
      text: "Here they are.",
      photos: [red, grey],
    });
    expect(queued.status).toBe(202);
    expect(setup.backend.received).toHaveLength(2);
    expect((await post(setup, "/interrupt")).status).toBe(200);
    await settle(setup);

    expect(setup.backend.received).toHaveLength(3);
    const turn = setup.backend.received[2];
    expect(turn?.learnerMessage).toBe("Here they are.");
    expect(turn?.images).toEqual(await kept(setup, [red, grey]));
  } finally {
    await setup.units.close();
  }
});

test("Move on pressed while a message's photos are being kept waits for the message, holding its place before a later Ready, and a message sent meanwhile is refused", async () => {
  const gate = keepingGate();
  const setup = setUp(
    [[{ text: "A map is fixed by a basis." }], [{ text: "I see it." }]],
    [],
    undefined,
    gate,
  );
  await approvedCourse();
  try {
    await openUnit(setup);
    const chat = setup.units.get(COURSE, "vectors");
    if (chat === undefined) throw new Error("The unit is not open.");
    const photo = await stage(setup, GREY, "grey.png");
    const sending = post(setup, "/messages", {
      text: "Mine.",
      photos: [photo],
    });
    await gate.entered;

    const moving = chat.override();
    const ready = chat.ready();
    expect(await chat.say("And this.")).toEqual({
      ok: false,
      status: 409,
      error: "Wait for Move on to finish.",
    });
    gate.release();
    expect((await sending).status).toBe(202);
    // The message's turn came first, so Move on, and Ready after it, find
    // the tutor writing.
    const writing = {
      ok: false,
      status: 409,
      error: "Wait until the tutor has finished, or stop it.",
    };
    expect(await moving).toEqual(writing);
    expect(await ready).toEqual(writing);
    await settle(setup);
    expect(learnerEvents(setup)).toEqual([
      {
        type: "learner",
        id: expect.any(String),
        text: "Mine.",
        photos: [photo],
      },
    ]);
    expect(setup.backend.received.at(-1)?.images).toEqual(
      await kept(setup, [photo]),
    );
  } finally {
    await setup.units.close();
  }
});

test("a unit closing while a message's photos are being kept refuses the message, and Move on and Ready queued behind it, and logs and sends nothing", async () => {
  const gate = keepingGate();
  const setup = setUp(
    [[{ text: "A map is fixed by a basis." }]],
    [],
    undefined,
    gate,
  );
  await approvedCourse();
  await openUnit(setup);
  const chat = setup.units.get(COURSE, "vectors");
  const photo = await stage(setup, GREY, "grey.png");
  const sending = post(setup, "/messages", { text: "Mine.", photos: [photo] });
  await gate.entered;
  const moving = chat?.override();
  const ready = chat?.ready();

  const closing = setup.units.close();
  gate.release();
  const refused = await sending;
  await closing;
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({ error: "The unit is closing." });
  const closed = { ok: false, status: 409, error: "The unit is closing." };
  expect(await moving).toEqual(closed);
  expect(await ready).toEqual(closed);
  expect(chat?.events().filter((event) => event.type === "learner")).toEqual(
    [],
  );
  expect(setup.backend.received).toHaveLength(1);
  expect((await setup.dataRoot.readState(COURSE)).units.vectors?.phase).toBe(
    "discuss",
  );
});

test("after a restart, reopening the unit replays the message with its photos, and sends nothing again", async () => {
  const sessions = new KeptSessions();
  const before = setUp(
    [[{ text: "A map is fixed by a basis." }], [{ text: "I see it." }]],
    [],
    sessions,
  );
  await approvedCourse();
  let photo: string;
  try {
    await openUnit(before);
    photo = await stage(before, GREY, "grey.png");
    expect(
      (await post(before, "/messages", { text: "Mine.", photos: [photo] }))
        .status,
    ).toBe(202);
    await settle(before);
  } finally {
    await before.units.close();
  }

  const after = setUp([], [], sessions);
  try {
    await openUnit(after);
    expect(learnerEvents(after)).toEqual([
      {
        type: "learner",
        id: expect.any(String),
        text: "Mine.",
        photos: [photo],
      },
    ]);
    expect(after.backend.received).toEqual([]);
    expect(await after.dataRoot.readPhoto(COURSE, photo)).toBeDefined();
  } finally {
    await after.units.close();
  }
});

test("the thread's photo route serves a sent photo as its JPEG, and finds none for another course, a photo staged and not sent, or an id that is not a photo's", async () => {
  const setup = setUp([
    [{ text: "A map is fixed by a basis." }],
    [{ text: "I see it." }],
  ]);
  await approvedCourse();
  // Another course with a unit of the same id, which kept no photos.
  const root = openDataRoot({ path: dir });
  const other = {
    title: "Geometry",
    units: [
      {
        id: "vectors",
        title: "Vectors",
        goal: "Add vectors.",
        prerequisites: [],
      },
    ],
    style: "Short.",
    background: "None.",
  };
  const { id: otherId } = await root.createCourse({ title: other.title });
  await root.saveProposal(otherId, other);
  await root.approveCurriculum(otherId, other);
  try {
    await openUnit(setup);
    const sent = await stage(setup, GREY, "grey.png");
    expect(
      (await post(setup, "/messages", { text: "", photos: [sent] })).status,
    ).toBe(202);
    await settle(setup);
    const waiting = await stage(setup, RED, "red.png");

    const served = await setup.app.request(`${UNIT}/photos/${sent}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await served.arrayBuffer())).toEqual(
      await setup.dataRoot.readPhoto(COURSE, sent),
    );

    for (const path of [
      `/api/courses/${otherId}/units/vectors/photos/${sent}`,
      `${UNIT}/photos/${waiting}`,
      `${UNIT}/photos/..%2F..%2Fcourse.json`,
      `/api/courses/${COURSE}/units/missing/photos/${sent}`,
    ]) {
      const refused = await setup.app.request(path);
      expect(refused.status, path).toBe(404);
      expect(await refused.json()).toEqual({ error: "No such photo." });
    }
  } finally {
    await setup.units.close();
  }
});

test("the exported transcript embeds a message's photos as data URLs, which its policy allows and nothing wider", async () => {
  const setup = setUp([
    [{ text: "A map is fixed by a basis." }],
    [{ text: "I see them." }],
  ]);
  await approvedCourse();
  try {
    await openUnit(setup);
    const grey = await stage(setup, GREY, "grey.png");
    const red = await stage(setup, RED, "red.png");
    expect(
      (
        await post(setup, "/messages", {
          text: "My working.",
          photos: [grey, red],
        })
      ).status,
    ).toBe(202);
    await settle(setup);

    const response = await setup.app.request(`${UNIT}/transcript`);
    expect(response.status).toBe(200);
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("img-src data:;");
    const html = await response.text();
    const images = await kept(setup, [grey, red]);
    expect(html).toContain(
      `<div class="learner" aria-label="Learner"><div class="photos">` +
        `<img src="data:image/jpeg;base64,${images[0]?.data.toString("base64")}" alt="Photo 1 of 2">` +
        `<img src="data:image/jpeg;base64,${images[1]?.data.toString("base64")}" alt="Photo 2 of 2">` +
        `</div>My working.</div>`,
    );
    // The file's own policy, which holds when it is opened from disk.
    expect(html).toMatch(
      /<meta http-equiv="Content-Security-Policy" content="[^"]*img-src data:;/,
    );
    expect(html).not.toContain(`/photos/${grey}`);
  } finally {
    await setup.units.close();
  }
});
