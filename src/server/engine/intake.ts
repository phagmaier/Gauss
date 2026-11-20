// The intake chat (brief.md, "How a course runs", steps 1 and 3). The learner
// says what they want to learn; the page asks that question itself, so the
// tutor's session starts with the learner's answer. The tutor asks what it
// needs to know, and cannot propose in reply to that first message (task
// 2.22). It proposes a curriculum, a style note and a background note with
// propose_curriculum, the learner pushes back by replying, and approves the
// latest revision on its card, which ends the intake.
//
// The first proposal creates the course, named by the proposal's title, and
// every proposal is stored as its draft curriculum, style note (task 2.10)
// and background note (task 2.22). Before the first one, nothing is stored.
// Revision numbers and the conversation are in memory, so a restart loses
// them; the stored draft can then be reopened for review in a new intake,
// which starts from it as proposal 1 (task 1.6).
//
// The tutor's session is kept, in the intakes' folder, so that it can be
// closed while idle and resumed with the next message (task 2.15). One that
// cannot be found then gives way to a new session, which is given the latest
// proposal, as a reopened draft's is, or before any proposal what was said
// so far (task 2.22a).
//
// Each session's first turn gives the planner the learner profile and the
// titles of the courses the learner has finished (task 5.8); a later turn
// gives it the profile again when profile.md has changed since. Every
// proposal carries the profile's whole text, and its card compares it with
// profile.md as it was then, which approval expects to replace.

import { randomUUID } from "node:crypto";
import type { Slug } from "../../shared/course.ts";
import type { ShownProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { TutorBackend } from "../backends/backend.ts";
import type { Backup } from "../record/backup.ts";
import {
  type DataRoot,
  DraftMismatch,
  ProfileChanged,
} from "../record/data-root.ts";
import { finishedCourses } from "../record/progress.ts";
import { proposeCurriculumTool } from "../tools/propose-curriculum.ts";
import {
  type ChatResult,
  createConversation,
  createEventLog,
  type Timer,
} from "./conversation.ts";

export interface Intake {
  /** Changes when the server restarts, so a page can tell. */
  readonly id: string;
  events(): readonly PageEvent[];
  /** Calls the listener with every new event and its index in the log. */
  subscribe(listener: (event: PageEvent, index: number) => void): () => void;
  /** The course, once the first proposal has created it. */
  courseId(): Slug | undefined;
  /** A message from the learner; the first one starts the tutor session. */
  say(text: string): ChatResult;
  /**
   * Approves the proposal with this revision number, which must be the
   * latest, while the tutor is not writing.
   */
  approve(revision: number): Promise<ChatResult>;
  /** Stops the tutor's turn in progress, if there is one. */
  interrupt(): Promise<void>;
  /** Resolves once every turn sent so far has finished. */
  settled(): Promise<void>;
  close(): Promise<void>;
}

/**
 * A stored draft whose intake is gone, to be reviewed again, with the
 * profile it was originally compared with. A draft stored before style
 * notes existed (task 2.10) has none.
 */
export interface StoredDraft {
  id: Slug;
  proposal: ShownProposal;
}

export function createIntake(options: {
  backend: TutorBackend;
  systemPrompt: string;
  dataRoot: DataRoot;
  /** Starts the intake from this draft, as its proposal 1. */
  draft?: StoredDraft;
  /** Closes the idle tutor session; the system's timer if not given. */
  timer?: Timer;
  /** Commits the record once a curriculum is approved (task 2.25); none if not given. */
  backup?: Backup;
}): Intake {
  const { backend, systemPrompt, dataRoot, draft } = options;
  const log = createEventLog();
  let courseId: Slug | undefined;
  let latest = 0;
  /** The latest proposal, as its card shows it; approval checks the record against it. */
  let shown: ShownProposal | undefined;
  let approved = false;
  /** The session to resume was lost: the next turn tells the new one where the intake stands. */
  let lost = false;
  /**
   * The turn in progress delivers the learner's first message, in reply to
   * which nothing is proposed. Set as each turn's text is composed, which is
   * after the turn before it has ended.
   */
  let opening = false;
  /** The profile the running session was last given; none before its first turn. */
  let told: string | undefined;

  const proposeCurriculum = proposeCurriculumTool({
    async propose(proposal) {
      if (approved) {
        return { refused: "The learner has approved the curriculum." };
      }
      if (opening) return { refused: FIRST_TURN };
      if (courseId === undefined) {
        courseId = (await dataRoot.createCourse({ title: proposal.title })).id;
      }
      const profileWas = (await dataRoot.readProfile()) ?? null;
      const card = { ...proposal, profileWas };
      await dataRoot.saveProposal(courseId, card);
      latest += 1;
      shown = card;
      emitProposal(courseId, shown);
      return { revision: latest };
    },
  });

  function emitProposal(id: Slug, proposal: ShownProposal): void {
    const { profile, profileWas } = proposal;
    log.emit({
      type: "curriculum_proposed",
      courseId: id,
      revision: latest,
      title: proposal.title,
      units: proposal.units,
      ...(proposal.style === undefined ? {} : { style: proposal.style }),
      ...(proposal.background === undefined
        ? {}
        : { background: proposal.background }),
      ...(profile === undefined ? {} : { profile }),
      ...(profile === undefined || profileWas === undefined
        ? {}
        : { profileWas }),
    });
  }

  /**
   * What the session is given about the learner beyond this course: all of
   * it in its first turn, and after that the profile when it has changed.
   */
  async function aboutTheLearner(
    first: boolean,
    profile: string | undefined,
  ): Promise<string | undefined> {
    if (first) {
      const finished = (await finishedCourses(dataRoot)).map((c) => c.title);
      return learnerBlock({ profile, finished });
    }
    return told === profile ? undefined : changedProfileBlock(profile);
  }

  const tools = [proposeCurriculum];
  const tutor = createConversation({
    start: async () =>
      backend.startSession({
        systemPrompt,
        tools,
        cwd: await dataRoot.intakeFolder(),
        title: "Gauss: new course",
      }),
    kept: {
      resume: async (id) =>
        backend.startSession({
          systemPrompt,
          tools,
          cwd: await dataRoot.intakeFolder(),
          resumeId: id,
        }),
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

  if (draft !== undefined) {
    courseId = draft.id;
    latest = 1;
    shown = draft.proposal;
    log.emit({ type: "draft_reopened" });
    emitProposal(courseId, draft.proposal);
  }

  return {
    id: log.id,
    events: log.events,
    subscribe: log.subscribe,
    courseId: () => courseId,
    say(text) {
      if (approved) {
        return { ok: false, status: 409, error: INTAKE_OVER };
      }
      const about = latest;
      const id = randomUUID();
      log.emit({ type: "learner", id, text });
      let profile: string | undefined;
      tutor.send({
        learnerId: id,
        // Composed when sent, since a lost session is found then.
        async text() {
          opening = false;
          profile = await dataRoot.readProfile();
          const learner = await aboutTheLearner(
            lost || !tutor.started(),
            profile,
          );
          if (lost) {
            return shown === undefined
              ? lostTurn(text, conversationBefore(log.events(), id), learner)
              : reviewTurn(text, shown, latest, learner);
          }
          if (tutor.started()) return messageTurn(text, about, learner);
          if (draft !== undefined) {
            return reviewTurn(text, draft.proposal, 1, learner);
          }
          opening = true;
          return openingTurn(text, learner);
        },
        sent() {
          told = profile;
          lost = false;
        },
      });
      return { ok: true };
    },
    async approve(revision) {
      if (approved) {
        return { ok: false, status: 409, error: INTAKE_OVER };
      }
      if (courseId === undefined || shown === undefined) {
        return { ok: false, status: 409, error: "Nothing has been proposed." };
      }
      if (!Number.isInteger(revision) || revision < 1 || revision > latest) {
        return { ok: false, status: 404, error: "No such proposal." };
      }
      if (revision < latest) {
        return {
          ok: false,
          status: 409,
          error: `Proposal ${revision} was replaced by proposal ${latest}.`,
        };
      }
      if (tutor.busy()) {
        return {
          ok: false,
          status: 409,
          error: "Wait until the tutor has finished.",
        };
      }
      // Set before writing, so nothing else can start meanwhile.
      approved = true;
      try {
        await dataRoot.approveCurriculum(courseId, shown);
      } catch (error) {
        approved = false;
        if (error instanceof DraftMismatch) {
          return { ok: false, status: 409, error: DRAFT_MISMATCH };
        }
        if (error instanceof ProfileChanged) {
          return {
            ok: false,
            status: 409,
            error:
              shown.profileWas === undefined
                ? PROFILE_UNKNOWN
                : PROFILE_CHANGED,
          };
        }
        throw error;
      }
      log.emit({ type: "curriculum_approved", courseId, revision });
      options.backup?.commit(`${courseId}: curriculum approved`);
      await tutor.close();
      return { ok: true };
    },
    interrupt: tutor.interrupt,
    settled: tutor.settled,
    close: tutor.close,
  };
}

const INTAKE_OVER = "The curriculum is approved; this intake is over.";

/** Why propose_curriculum is refused in the intake's first turn. */
const FIRST_TURN =
  "Not in reply to the learner's first message: nothing is proposed before " +
  "they have answered you once. Ask what you still need to know (their " +
  "background, what they already understand, how far to go), at most two " +
  "questions; or, if you know enough, say in a few lines what you would " +
  "propose and ask whether to go ahead. Then end your turn.";

/** The record holds a draft other than the card's, from a save that failed partway. */
const DRAFT_MISMATCH =
  "The curriculum on record is not the one on this card: saving the " +
  "tutor's last change did not finish. Ask the tutor to propose it again.";

/** profile.md changed after the card's proposal was made. */
const PROFILE_CHANGED =
  "Your profile was changed after this proposal was made, so approving " +
  "it would replace that change unseen. Ask the tutor to propose again: " +
  "it will be given your profile as it is now.";

const PROFILE_UNKNOWN =
  "This draft did not keep the profile from when it was proposed. Ask " +
  "the tutor to propose again before approving.";

/**
 * The intakes started since the server did, by id. An intake stays after it
 * ends, so a page can still replay it; none outlives the server.
 */
export interface Intakes {
  /** Starts an intake; its tutor session starts with the first message. */
  start(): Intake;
  get(id: string): Intake | undefined;
  /**
   * The course's intake, or a new one that starts from the stored draft.
   * Ownership stays after approval, so a stale draft read cannot create a
   * second intake. The caller checks that it is the stored draft.
   */
  review(draft: StoredDraft): Intake;
  /** Closes the tutor session of every intake. */
  close(): Promise<void>;
}

export function createIntakes(options: {
  backend: TutorBackend;
  systemPrompt: string;
  dataRoot: DataRoot;
  timer?: Timer;
  backup?: Backup;
}): Intakes {
  const byId = new Map<string, Intake>();
  function keep(intake: Intake): Intake {
    byId.set(intake.id, intake);
    return intake;
  }
  return {
    start: () => keep(createIntake(options)),
    get: (id) => byId.get(id),
    review(draft) {
      for (const intake of byId.values()) {
        if (intake.courseId() === draft.id) return intake;
      }
      return keep(createIntake({ ...options, draft }));
    },
    async close() {
      await Promise.allSettled([...byId.values()].map((i) => i.close()));
    },
  };
}

// --- Turns: a header saying what is allowed now, then what Gauss keeps
// about the learner when the turn gives it, then the learner's text ---

/** What the planner is given about the learner beyond this course (task 5.8). */
interface Known {
  profile: string | undefined;
  /** The titles of the courses the learner has finished. */
  finished: readonly string[];
}

/** Said in a header whose turn gives the planner what Gauss keeps about the learner. */
const ABOUT =
  "Before their message comes what Gauss keeps about the learner across " +
  "their courses, in <about_the_learner>.";

/** For a session's first turn: the learner profile and the courses finished. */
function learnerBlock(known: Known): string {
  const { profile, finished } = known;
  return [
    "<about_the_learner>",
    profile === undefined
      ? "They have no profile yet."
      : `Their profile:\n<profile>\n${profile}\n</profile>`,
    finished.length === 0
      ? "They have finished no course yet."
      : `The courses they have finished: ${finished.map((t) => JSON.stringify(t)).join(", ")}.`,
    "</about_the_learner>",
  ].join("\n");
}

/** For a later turn, once profile.md has changed since the session was given it. */
function changedProfileBlock(profile: string | undefined): string {
  return [
    "<about_the_learner>",
    profile === undefined
      ? "Their profile was removed since you were given it: they have none now."
      : "Their profile changed since you were given it. It now reads as " +
        "follows; propose from this text.\n" +
        `<profile>\n${profile}\n</profile>`,
    "</about_the_learner>",
  ].join("\n");
}

/** A turn: the header, then the block about the learner if there is one, then their text. */
function withLearner(
  header: string,
  learner: string | undefined,
  text: string,
): string {
  return learner === undefined
    ? `[${header}]\n${text}`
    : `[${header} ${ABOUT}]\n${learner}\n\n${text}`;
}

function openingTurn(text: string, learner: string | undefined): string {
  return withLearner(
    "Start of the intake. The app has asked the learner what they want to " +
      "learn and what they already know. Allowed now: ask what you still " +
      "need to know and neither their answer nor what Gauss keeps about " +
      "them tells you, at most two questions, or say what you would " +
      "propose and ask whether to go ahead. propose_curriculum is refused " +
      "in this turn.",
    learner,
    text,
  );
}

/** The first turn of a session that takes over a proposal from a conversation lost. */
function reviewTurn(
  text: string,
  draft: ShownProposal,
  revision: number,
  learner: string | undefined,
): string {
  const { profileWas: _, ...proposal } = draft;
  return withLearner(
    `The learner is reviewing proposal ${revision}, a curriculum proposed in an ` +
      "earlier conversation that was not kept:\n" +
      `${JSON.stringify(proposal)}\n` +
      "They have not approved it. Allowed now: answer them; if they ask " +
      "for changes, call propose_curriculum with the whole revised " +
      "curriculum, its style note, its background note and the learner's " +
      "profile (writing any it lacks), keeping the ids of the units you " +
      "keep.",
    learner,
    text,
  );
}

/** One message of a planning conversation: the learner's, or the planner's reply. */
export interface Said {
  from: "learner" | "planner";
  text: string;
}

/**
 * What was said before the learner's message with this id, oldest first, as
 * the page shows it: their earlier messages and every reply the planner
 * wrote. Composed when that message's turn is sent, so every turn before it
 * has ended; messages the learner sent after it come as turns of their own.
 */
export function conversationBefore(
  events: readonly PageEvent[],
  learnerId: string,
): Said[] {
  const said: Said[] = [];
  let reply = "";
  let reached = false;
  const endReply = () => {
    if (reply.trim() !== "") said.push({ from: "planner", text: reply.trim() });
    reply = "";
  };
  for (const event of events) {
    if (event.type === "learner") {
      if (event.id === learnerId) reached = true;
      if (reached) continue;
      endReply();
      said.push({ from: "learner", text: event.text });
    } else if (event.type === "tutor_text") {
      reply += event.text;
    } else if (event.type === "turn_end") {
      endReply();
    }
  }
  endReply();
  return said;
}

/**
 * The first turn of a session that takes over from a conversation lost
 * before any proposal (task 2.15), with what was said in it (task 2.22a):
 * since 2.22 the learner's message is usually an answer to a question the
 * new session never saw. A session is lost only after one was started for
 * an earlier message, so there is always something said before.
 */
function lostTurn(
  text: string,
  said: readonly Said[],
  learner: string | undefined,
): string {
  return withLearner(
    "This conversation is new: the one before it with the learner was " +
      "lost, so you have not seen it. What was said in it, oldest first, as " +
      'JSON (the "planner" messages are your replies):\n' +
      // Followed by a space: "]\n" is where the header ends.
      `${JSON.stringify(said)} ` +
      "Their new message follows. Allowed now: reply, or propose a " +
      "curriculum with propose_curriculum.",
    learner,
    text,
  );
}

function messageTurn(
  text: string,
  proposal: number,
  learner: string | undefined,
): string {
  const header =
    proposal === 0
      ? "Message from the learner. Allowed now: reply, or propose a " +
        "curriculum with propose_curriculum."
      : `Message from the learner about proposal ${proposal}, which they ` +
        "have not approved. Allowed now: answer them; if they ask for " +
        "changes, call propose_curriculum with the whole revised curriculum, " +
        "its style note, its background note and the learner's profile.";
  return withLearner(header, learner, text);
}
