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

import { randomUUID } from "node:crypto";
import type { Slug } from "../../shared/course.ts";
import type { ShownProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { TutorBackend } from "../backends/backend.ts";
import { type DataRoot, DraftMismatch } from "../record/data-root.ts";
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
 * A stored draft whose intake is gone, to be reviewed again. A draft stored
 * before style notes existed (task 2.10) has none.
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

  const proposeCurriculum = proposeCurriculumTool({
    async propose(proposal) {
      if (approved) {
        return { refused: "The learner has approved the curriculum." };
      }
      if (opening) return { refused: FIRST_TURN };
      if (courseId === undefined) {
        courseId = (await dataRoot.createCourse({ title: proposal.title })).id;
      }
      await dataRoot.saveProposal(courseId, proposal);
      latest += 1;
      shown = proposal;
      log.emit({
        type: "curriculum_proposed",
        courseId,
        revision: latest,
        title: proposal.title,
        units: proposal.units,
        style: proposal.style,
        background: proposal.background,
      });
      return { revision: latest };
    },
  });

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
    log.emit({
      type: "curriculum_proposed",
      courseId,
      revision: latest,
      ...draft.proposal,
    });
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
      tutor.send({
        learnerId: id,
        // Composed when sent, since a lost session is found then.
        text() {
          opening = false;
          if (lost) {
            lost = false;
            return shown === undefined
              ? lostTurn(text, conversationBefore(log.events(), id))
              : reviewTurn(text, shown, latest);
          }
          if (tutor.started()) return messageTurn(text, about);
          if (draft !== undefined) return reviewTurn(text, draft.proposal, 1);
          opening = true;
          return openingTurn(text);
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
        throw error;
      }
      log.emit({ type: "curriculum_approved", courseId, revision });
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

// --- Turns: a header saying what is allowed now, then the learner's text ---

function openingTurn(text: string): string {
  return (
    "[Start of the intake. The app has asked the learner what they want to " +
    "learn and what they already know; their answer follows. Allowed now: " +
    "ask what you still need to know, at most two questions, or say what " +
    "you would propose and ask whether to go ahead. propose_curriculum is " +
    `refused in this turn.]\n${text}`
  );
}

/** The first turn of a session that takes over a proposal from a conversation lost. */
function reviewTurn(
  text: string,
  draft: ShownProposal,
  revision: number,
): string {
  return (
    `[The learner is reviewing proposal ${revision}, a curriculum proposed in an ` +
    "earlier conversation that was not kept:\n" +
    `${JSON.stringify(draft)}\n` +
    "They have not approved it; their message follows. Allowed now: answer " +
    "them; if they ask for changes, call propose_curriculum with the whole " +
    "revised curriculum, its style note and its background note (writing " +
    "any note it lacks), keeping the ids of the units you keep.]\n" +
    text
  );
}

/** One message of the intake's conversation: the learner's, or the planner's reply. */
interface Said {
  from: "learner" | "planner";
  text: string;
}

/**
 * What was said before the learner's message with this id, oldest first, as
 * the page shows it: their earlier messages and every reply the planner
 * wrote. Composed when that message's turn is sent, so every turn before it
 * has ended; messages the learner sent after it come as turns of their own.
 */
function conversationBefore(
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
function lostTurn(text: string, said: readonly Said[]): string {
  return (
    "[This conversation is new: the one before it with the learner was " +
    "lost, so you have not seen it. What was said in it, oldest first, as " +
    'JSON (the "planner" messages are your replies):\n' +
    // Followed by a space: "]\n" is where the header ends.
    `${JSON.stringify(said)} ` +
    "Their new message follows. Allowed now: reply, or propose a " +
    `curriculum with propose_curriculum.]\n${text}`
  );
}

function messageTurn(text: string, proposal: number): string {
  const header =
    proposal === 0
      ? "[Message from the learner. Allowed now: reply, or propose a " +
        "curriculum with propose_curriculum.]"
      : `[Message from the learner about proposal ${proposal}, which they ` +
        "have not approved. Allowed now: answer them; if they ask for " +
        "changes, call propose_curriculum with the whole revised curriculum, " +
        "its style note and its background note.]";
  return `${header}\n${text}`;
}
