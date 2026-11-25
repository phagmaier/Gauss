// Planning from the course view (task 5.38; docs/brief.md, "Page"): a
// conversation of an approved course with the planner, run as the intake is
// (intake.ts). The page asks the opening question itself, so the session
// starts with the learner's answer.
//
// The planner is given the course: its units, each with its status and its
// objectives' statuses, the style note (which names a large course's later
// stretches), the background note and the learner profile. A later turn
// gives them again when any of them has changed since the session was given
// them. It proposes with amend_curriculum, whose card is the unit tutor's
// (task 5.12), with Apply and "Keep the current one"; posting ends its turn,
// and a new proposal replaces the one waiting. A change's rules are the unit
// tutor's: a started unit cannot be dropped, and one proposal waits per
// course, which the course's desk (unit-chat.ts) keeps across the unit chats
// and this conversation. Apply writes curriculum.json, tells the course's
// open unit chats, and ends the conversation; "Keep the current one" is said
// in the planner's next header.
//
// A conversation is kept in memory, as an intake is: a restart loses it,
// its waiting proposal and the sources waiting, and nothing has changed. It
// has no transcript. Its session is kept in the intakes' folder, so that it
// can be closed while idle and resumed (task 2.15); one that cannot be found
// gives way to a new session, which is given the earlier messages and
// proposals with their outcomes.
//
// The learner can attach sources here (attached-sources.ts, piece 26), as in
// the intake: each turn waits for the files being converted and tells the
// planner of each attached, removed or refused since it was last told. They
// wait in the conversation's uploads; Apply moves them into the course with
// the change, and a conversation that applies nothing adds none.

import { randomUUID } from "node:crypto";
import type { Slug } from "../../shared/course.ts";
import { type StoredUnit, unitSections } from "../../shared/curriculum.ts";
import {
  type CurriculumChange,
  type CurriculumChangeOutcome,
  droppedStarted,
  sameUnits,
  withoutPlan,
} from "../../shared/curriculum-change.ts";
import type { PageEvent } from "../../shared/events.ts";
import { isFinished } from "../../shared/status.ts";
import type { SessionBackend } from "../backends/backend.ts";
import type { Backup } from "../record/backup.ts";
import { CurriculumChangeRefused, type DataRoot } from "../record/data-root.ts";
import { courseProgress } from "../record/progress.ts";
import { planCurriculumChangeTool } from "../tools/amend-curriculum.ts";
import {
  type AttachedSources,
  type AttachResult,
  createAttachedSources,
  type SourcesTold,
  type Upload,
} from "./attached-sources.ts";
import {
  type ChatResult,
  createConversation,
  createEventLog,
  type Timer,
} from "./conversation.ts";
import type { CourseHolder } from "./course-deletion.ts";
import { conversationBefore, type Said } from "./intake.ts";
import type { SourceConverter } from "./source-convert.ts";
import { sourceLines } from "./source-text.ts";
import type { CourseDesk, UnitChats } from "./unit-chat.ts";

export interface CoursePlanning {
  /** Changes when the server restarts, so a page can tell. */
  readonly id: string;
  readonly courseId: Slug;
  events(): readonly PageEvent[];
  /** Calls the listener with every new event and its index in the log. */
  subscribe(listener: (event: PageEvent, index: number) => void): () => void;
  /** A change was applied, which ends the conversation. */
  ended(): boolean;
  /** A message from the learner; the first one starts the planner's session. */
  say(text: string): ChatResult;
  /**
   * A file the learner attached: received now, then converted. It joins the
   * course when a change is applied.
   */
  attach(upload: Upload): Promise<AttachResult>;
  /** Removes an attached source, unless the proposal waiting reads it. */
  removeSource(attachment: string): Promise<ChatResult>;
  withSourceHome: AttachedSources["withSourceHome"];
  /** Apply on the card of the proposal waiting, while the planner is not writing. */
  apply(proposalId: string): Promise<ChatResult>;
  /** "Keep the current one" on the card of the proposal waiting. */
  keep(proposalId: string): Promise<ChatResult>;
  /** Stops the planner's turn in progress, if there is one. */
  interrupt(): Promise<void>;
  /** Resolves once every file attached is converted and every turn sent so far has finished. */
  settled(): Promise<void>;
  /**
   * Its page reads the event stream, or the planner writes, a file
   * converts, or its change is being applied.
   */
  inUse(): "planning-page" | "planning" | undefined;
  close(): Promise<void>;
}

interface PlanningOptions {
  backend: SessionBackend;
  /** `prompts/course-planner.md`. */
  systemPrompt: string;
  dataRoot: DataRoot;
  /** The course's side of the unit chats: its queue of proposals, and its open chats. */
  units: Pick<UnitChats, "courseDesk">;
  /** Commits the record once a change is applied; none if not given. */
  backup?: Backup;
  /** Closes the idle planner session; the system's timer if not given. */
  timer?: Timer;
  /** The clock for a proposal's time; the system's if not given. */
  now?: () => Date;
  /** Converts the sources attached; none can be attached if not given. */
  converter?: SourceConverter;
  /** The largest source taken, in bytes; SOURCE_SIZE_LIMIT unless a test sets it. */
  sourceSizeLimit?: number;
}

export function createCoursePlanning(
  options: PlanningOptions & { courseId: Slug },
): CoursePlanning {
  const { backend, systemPrompt, dataRoot, courseId } = options;
  const now = options.now ?? (() => new Date());
  const desk: CourseDesk = options.units.courseDesk(courseId);
  const log = createEventLog();
  /** The planner's proposal on its card, until it is answered or replaced. */
  let waiting: CurriculumChange | undefined;
  /** The learner kept the current curriculum since the planner's last turn was sent. */
  let kept = false;
  let status: "open" | "applying" | "applied" = "open";
  /** The session to resume was lost: the next turn tells the new one what was said. */
  let lost = false;
  /** The course as the running session was last given it; none before its first turn. */
  let told: string | undefined;
  const sources = createAttachedSources({
    uploadsId: log.id,
    dataRoot,
    converter: options.converter,
    destination: {
      planning: courseId,
      reads: (sourceId) =>
        waiting?.units.some((unit) =>
          unitSections(unit).some((ref) => ref.startsWith(`${sourceId}/`)),
        ) === true,
    },
    emit: log.emit,
    ...(options.sourceSizeLimit === undefined
      ? {}
      : { sizeLimit: options.sourceSizeLimit }),
  });

  const amend = planCurriculumChangeTool({
    async propose({ units, why }, signal) {
      const refused = notOpen();
      if (refused !== undefined) return { refused: refused.error };
      return desk.propose(async (state) => {
        const current = (await dataRoot.readCourse(courseId))?.curriculum;
        if (current?.approval.status !== "approved") {
          return { refused: "The course has no approved curriculum." };
        }
        if (sameUnits(current.units, units)) {
          return {
            refused: "That is the current curriculum: nothing would change.",
          };
        }
        const dropped = droppedStarted(current.units, units, state);
        if (dropped !== undefined) return { refused: dropped };
        const sections = await sources.checkProposal(units);
        if (sections !== undefined) return { refused: sections };
        // A turn stopped while this waited for the course shows nothing,
        // replaces nothing and blocks no unit tutor, as in a unit's chat.
        signal?.throwIfAborted();
        const change: CurriculumChange = {
          id: randomUUID(),
          units,
          was: current.units.map(withoutPlan),
          why,
          proposedAt: now().toISOString(),
        };
        if (waiting !== undefined) {
          log.emit({
            type: "curriculum_change_answered",
            proposalId: waiting.id,
            outcome: "replaced",
          });
        }
        waiting = change;
        log.emit({
          type: "curriculum_change_proposed",
          proposalId: change.id,
          units: change.units,
          was: change.was,
          why: change.why,
        });
        return { proposed: true };
      });
    },
  });

  const start = async (resumeId?: string) =>
    backend.startSession({
      systemPrompt,
      tools: [amend],
      cwd: await dataRoot.intakeFolder(),
      ...(resumeId === undefined
        ? { title: `Gauss: planning ${await courseTitle(dataRoot, courseId)}` }
        : { resumeId }),
    });
  const planner = createConversation({
    start: () => start(),
    kept: {
      resume: (id) => start(id),
      lost(learnerId) {
        lost = true;
        told = undefined;
        log.emit({
          type: "fresh_start",
          reason: "not-resumed",
          ...(learnerId === undefined ? {} : { learnerId }),
        });
      },
      ...(options.timer === undefined ? {} : { timer: options.timer }),
    },
    log,
  });

  function notOpen() {
    if (status === "open") return undefined;
    return {
      ok: false,
      status: 409,
      error: status === "applying" ? APPLYING : OVER,
    } as const;
  }

  function notWaiting(proposalId: string): ChatResult | undefined {
    const refused = notOpen();
    if (refused !== undefined) return refused;
    if (waiting?.id !== proposalId) {
      return {
        ok: false,
        status: 409,
        error: "That proposed change is not waiting.",
      };
    }
    return undefined;
  }

  return {
    id: log.id,
    courseId,
    events: log.events,
    subscribe: log.subscribe,
    ended: () => status === "applied",
    say(text) {
      const refused = notOpen();
      if (refused !== undefined) return refused;
      const id = randomUUID();
      log.emit({ type: "learner", id, text });
      let given: string | undefined;
      let answered = false;
      let attached: SourcesTold | undefined;
      planner.send({
        learnerId: id,
        learnerMessage: text,
        // Composed when sent, so it says how the course stands then.
        async text() {
          // The planner's turn has the outline of every file sent before.
          await sources.settled();
          attached = await sources.forTurn(lost || !planner.started());
          const course = await courseContext(dataRoot, courseId);
          given = course.text;
          answered = kept;
          const changed = told === course.text ? undefined : course.text;
          if (lost) {
            const events = log.events();
            return lostTurn(
              text,
              conversationBefore(events, id),
              previousProposals(events),
              {
                course: course.text,
                sources: await sourcesBlock(dataRoot, courseId),
                attached: attached.block,
              },
            );
          }
          if (!planner.started()) {
            return openingTurn(text, course.finished, {
              course: course.text,
              sources: await sourcesBlock(dataRoot, courseId),
              attached: attached.block,
            });
          }
          return messageTurn(text, waiting !== undefined, answered, {
            course: changed,
            attached: attached.block,
          });
        },
        sent() {
          told = given;
          lost = false;
          if (answered) kept = false;
          attached?.sent();
        },
      });
      return { ok: true };
    },
    async attach(upload) {
      const refused = notOpen();
      if (refused !== undefined) return refused;
      return sources.attach(upload);
    },
    async removeSource(attachment) {
      const refused = notOpen();
      if (refused !== undefined) return refused;
      return sources.remove(attachment);
    },
    withSourceHome: sources.withSourceHome,
    async apply(proposalId) {
      const refused = notWaiting(proposalId);
      if (refused !== undefined) return refused;
      if (planner.busy()) {
        return {
          ok: false,
          status: 409,
          error: "Wait until the planner has finished.",
        };
      }
      if (sources.converting()) {
        return {
          ok: false,
          status: 409,
          error:
            "Wait until the file is converted: it joins the course with the change.",
        };
      }
      const change = waiting;
      if (change === undefined) return { ok: false, status: 409, error: OVER };
      // Block new work without letting open() create a second conversation
      // before the write succeeds.
      status = "applying";
      let units: StoredUnit[];
      try {
        units = await sources.admit((admitted) =>
          dataRoot.changeCurriculum(
            courseId,
            change.units,
            admitted.length === 0
              ? undefined
              : { uploads: log.id, sources: admitted },
          ),
        );
      } catch (error) {
        status = "open";
        if (error instanceof CurriculumChangeRefused) {
          return {
            ok: false,
            status: 409,
            error: `This change can no longer be applied. ${error.message}`,
          };
        }
        throw error;
      }
      status = "applied";
      waiting = undefined;
      desk.answered({ outcome: "applied", units });
      options.backup?.commit(`${courseId}: curriculum changed`);
      log.emit({
        type: "curriculum_change_answered",
        proposalId,
        outcome: "applied",
      });
      await Promise.all([planner.close(), sources.close()]);
      return { ok: true };
    },
    async keep(proposalId) {
      const refused = notWaiting(proposalId);
      if (refused !== undefined) return refused;
      waiting = undefined;
      kept = true;
      desk.answered({ outcome: "kept" });
      log.emit({
        type: "curriculum_change_answered",
        proposalId,
        outcome: "kept",
      });
      return { ok: true };
    },
    interrupt: planner.interrupt,
    async settled() {
      await sources.settled();
      await planner.settled();
    },
    inUse() {
      if (log.watched()) return "planning-page";
      return planner.busy() || status === "applying" || sources.converting()
        ? "planning"
        : undefined;
    },
    async close() {
      await Promise.all([planner.close(), sources.close()]);
    },
  };
}

const APPLYING = "Wait until the curriculum change has been applied.";

/** Said once a change is applied. */
const OVER =
  "The change is applied, and this planning conversation is over. Start a " +
  "new one from the course view.";

/**
 * The planning conversations started since the server did, by id. One stays
 * after it ends, so a page can still replay it; none outlives the server,
 * and those of a deleted course go with it.
 */
export interface CoursePlannings extends CourseHolder {
  /**
   * The course's conversation that has not ended, or a new one; refused for
   * a course with no approved curriculum.
   */
  open(
    courseId: string,
  ): Promise<
    | { ok: true; planning: CoursePlanning }
    | { ok: false; status: 404 | 409; error: string }
  >;
  get(courseId: string, id: string): CoursePlanning | undefined;
  /** Closes the planner session of every conversation, and drops its sources waiting. */
  close(): Promise<void>;
}

export function createCoursePlannings(
  options: PlanningOptions,
): CoursePlannings {
  const byId = new Map<string, CoursePlanning>();
  /** The conversation of each course that has not ended. */
  const current = new Map<string, CoursePlanning>();
  return {
    async open(courseId) {
      const stored = await options.dataRoot.readCourse(courseId);
      if (stored === undefined) {
        return { ok: false, status: 404, error: "No such course." };
      }
      if (stored.curriculum?.approval.status !== "approved") {
        return {
          ok: false,
          status: 409,
          error:
            "The curriculum is not approved yet: review it instead of changing it.",
        };
      }
      // Looked up after the await and kept at once, so two opens share one.
      const open = current.get(stored.id);
      if (open !== undefined && !open.ended())
        return { ok: true, planning: open };
      const planning = createCoursePlanning({
        ...options,
        courseId: stored.id,
      });
      byId.set(planning.id, planning);
      current.set(stored.id, planning);
      return { ok: true, planning };
    },
    get(courseId, id) {
      const planning = byId.get(id);
      return planning?.courseId === courseId ? planning : undefined;
    },
    async close() {
      await Promise.allSettled([...byId.values()].map((p) => p.close()));
    },
    inUse(courseId) {
      for (const planning of byId.values()) {
        const doing =
          planning.courseId === courseId ? planning.inUse() : undefined;
        if (doing !== undefined) return { doing };
      }
      return undefined;
    },
    async forget(courseId) {
      const gone = [...byId.values()].filter((p) => p.courseId === courseId);
      for (const planning of gone) byId.delete(planning.id);
      current.delete(courseId);
      await Promise.allSettled(gone.map((planning) => planning.close()));
    },
  };
}

async function courseTitle(dataRoot: DataRoot, courseId: Slug) {
  return (await dataRoot.readCourse(courseId))?.course.title ?? courseId;
}

// --- Turns: a header saying what is allowed now, then the course when the
// turn gives it, the sources in a session's first turn, and the files
// attached here when there is news of them, then the learner's text ---

/**
 * The course as the planner sees it, in `<course>`, with what Gauss keeps
 * about the learner; and whether every unit is finished.
 */
async function courseContext(
  dataRoot: DataRoot,
  courseId: Slug,
): Promise<{ text: string; finished: boolean }> {
  const stored = await dataRoot.readCourse(courseId);
  const curriculum = stored?.curriculum;
  if (stored === undefined || curriculum == null) {
    throw new Error(`The course "${courseId}" has no curriculum.`);
  }
  const [state, evidence, style, background, profile] = await Promise.all([
    dataRoot.readState(courseId),
    dataRoot.readEvidence(courseId),
    dataRoot.readStyle(courseId),
    dataRoot.readBackground(courseId),
    dataRoot.readProfile(),
  ]);
  const progress = courseProgress(curriculum, state, evidence);
  const units = curriculum.units.map((unit) => {
    const at = Object.hasOwn(progress, unit.id) ? progress[unit.id] : undefined;
    const sections = unitSections(unit);
    return {
      id: unit.id,
      title: unit.title,
      goal: unit.goal,
      prerequisites: unit.prerequisites,
      ...(sections.length === 0 ? {} : { sections }),
      status: at?.status ?? "not-started",
      ...(unit.plan === undefined
        ? {}
        : {
            objectives: unit.plan.objectives.map((o) => ({
              id: o.id,
              statement: o.statement,
              status: at?.objectives?.[o.id] ?? "not-started",
            })),
          }),
    };
  });
  const reads = units.some((u) => u.sections !== undefined)
    ? " and the sections of the sources it teaches"
    : "";
  const text = [
    "<course>",
    `The course "${stored.course.title}". Its units, in order, as JSON, ` +
      `each with its status${reads}, and a unit that has started with its ` +
      "objectives and their statuses:",
    JSON.stringify(units),
    style === undefined
      ? "The course has no style note."
      : `Its style note, on how it is taught:\n<style_note>\n${style}\n</style_note>`,
    background === undefined
      ? "No background note was recorded for it."
      : "What the learner told the planner when the course was made:\n" +
        `<background_note>\n${background}\n</background_note>`,
    "</course>",
    "<about_the_learner>",
    profile === undefined
      ? "They have no profile."
      : `Their profile, which holds across their courses:\n<profile>\n${profile}\n</profile>`,
    "</about_the_learner>",
  ].join("\n");
  const finished = curriculum.units.every((unit) => {
    const status = Object.hasOwn(progress, unit.id)
      ? progress[unit.id]?.status
      : undefined;
    return status !== undefined && isFinished(status);
  });
  return { text, finished };
}

/**
 * The course's sources, each with its outline, in `<sources>`; none for a
 * course with no source. Given in a session's first turn only: they change
 * only when this conversation's change is applied, which ends it.
 */
async function sourcesBlock(
  dataRoot: DataRoot,
  courseId: Slug,
): Promise<string | undefined> {
  const sources = await dataRoot.readSources(courseId);
  if (sources.length === 0) return undefined;
  return [
    "<sources>",
    'The course\'s sources. A unit names a section it teaches as "<source id>/<section id>".',
    ...sources.flatMap((source) => ["", ...sourceLines(source)]),
    "</sources>",
  ].join("\n");
}

/** Said in a header whose turn gives the planner the course. */
const GIVEN =
  "Before their message come the course, in <course>, and what Gauss keeps " +
  "about the learner, in <about_the_learner>.";

/** Said in a header whose turn gives the planner the course's sources. */
const SOURCES_GIVEN =
  "After them come the course's sources, each with its outline, in <sources>.";

/** Said in a header whose turn tells the planner of the files attached here. */
const ATTACHED_GIVEN =
  "<attached_sources> says what changed in the files the learner attached " +
  "in this conversation since you were last told: each attached, with its " +
  "outline; each they removed; and each that could not be attached. " +
  "An attached source joins the course's sources when the learner applies " +
  "a change, whether or not a unit reads it; a unit names its sections as " +
  '"<source id>/<section id>", as it does those of the course\'s sources.';

/** What a turn gives the planner before the learner's text, each when there is one. */
interface Blocks {
  course?: string | undefined;
  /** The course's sources; only with the course. */
  sources?: string | undefined;
  attached?: string | undefined;
}

/**
 * A turn: the header, then the course if the turn gives it, the course's
 * sources if it gives them, and the files attached if there is news of
 * them, then their text.
 */
function withBlocks(header: string, blocks: Blocks, text: string): string {
  const { course, sources, attached } = blocks;
  const said = [header];
  const given: string[] = [];
  if (course !== undefined) {
    said.push(GIVEN);
    given.push(course);
    if (sources !== undefined) {
      said.push(SOURCES_GIVEN);
      given.push(sources);
    }
  }
  if (attached !== undefined) {
    said.push(ATTACHED_GIVEN);
    given.push(attached);
  }
  return given.length === 0
    ? `[${header}]\n${text}`
    : `[${said.join(" ")}]\n${given.join("\n")}\n\n${text}`;
}

const ALLOWED =
  "Allowed now: reply, asking what you need to know (at most two " +
  "questions), or propose a change with amend_curriculum.";

const WAITING =
  "Your last proposal waits on its card: they have not applied it. " +
  "Allowed now: answer them; if they ask for changes, call " +
  "amend_curriculum with the whole revised list, which replaces it.";

/** The page's opening question, which the learner's first message answers. */
function openingTurn(text: string, finished: boolean, blocks: Blocks): string {
  return withBlocks(
    "Start of a planning conversation of this course. " +
      (finished
        ? "Every unit is finished, and the app has asked the learner what " +
          "they would like to do next. "
        : "The app has asked the learner what they would like to change " +
          "in the curriculum. ") +
      ALLOWED,
    blocks,
    text,
  );
}

function messageTurn(
  text: string,
  waits: boolean,
  kept: boolean,
  blocks: Pick<Blocks, "course" | "attached">,
): string {
  const header = [
    "Message from the learner.",
    ...(kept
      ? [
          'They chose "Keep the current one" on your last proposal: the ' +
            "curriculum is as it was. Do not propose the same change again " +
            "unless they ask for it.",
        ]
      : []),
    ...(blocks.course === undefined
      ? []
      : ["The course or their profile changed since you were given them."]),
    waits ? WAITING : ALLOWED,
  ].join(" ");
  return withBlocks(header, blocks, text);
}

type PreviousProposal = Pick<CurriculumChange, "units" | "why"> & {
  outcome: CurriculumChangeOutcome | "waiting";
};

/** The cards the learner saw and what happened to each, in proposal order. */
function previousProposals(events: readonly PageEvent[]): PreviousProposal[] {
  const proposals = new Map<string, PreviousProposal>();
  for (const event of events) {
    if (event.type === "curriculum_change_proposed") {
      proposals.set(event.proposalId, {
        units: event.units,
        why: event.why,
        outcome: "waiting",
      });
    } else if (event.type === "curriculum_change_answered") {
      const proposal = proposals.get(event.proposalId);
      if (proposal !== undefined) proposal.outcome = event.outcome;
    }
  }
  return [...proposals.values()];
}

/**
 * The first turn of a session that takes over from a conversation lost
 * (task 2.15), with what was said and how the learner answered its cards.
 */
function lostTurn(
  text: string,
  said: readonly Said[],
  proposals: readonly PreviousProposal[],
  blocks: Blocks,
): string {
  const allowed = proposals.at(-1)?.outcome === "waiting" ? WAITING : ALLOWED;
  return withBlocks(
    "This conversation is new: the one before it with the learner was " +
      "lost, so you have not seen it. What was said in it, oldest first, as " +
      'JSON (the "planner" messages are your replies):\n' +
      // Followed by a space: "]\n" is where the header ends.
      `${JSON.stringify(said)} ` +
      (proposals.length === 0
        ? ""
        : "Your earlier proposals and their outcomes, oldest first, as JSON:\n" +
          `${JSON.stringify(proposals)} ` +
          '"kept" means they chose to keep the current curriculum instead. ' +
          "Do not repeat those proposals unless the learner asks for them. ") +
      `Their new message follows. ${allowed}`,
    blocks,
    text,
  );
}
