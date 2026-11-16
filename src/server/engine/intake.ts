// The intake chat (brief.md, "How a course runs", steps 1 and 3). The learner
// says what they want to learn; the page asks that question itself, so the
// tutor's session starts with the learner's answer. The tutor proposes a
// curriculum and a style note with propose_curriculum, the learner pushes
// back by replying, and approves the latest revision on its card, which
// ends the intake.
//
// The first proposal creates the course, named by the proposal's title, and
// every proposal is stored as its draft curriculum and style note (task
// 2.10). Before the first one, nothing is stored. Revision numbers and the
// conversation are in memory, so a restart loses them; the stored draft can
// then be reopened for review in a new intake, which starts from it as
// proposal 1 (task 1.6).

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
}): Intake {
  const { dataRoot, draft } = options;
  const log = createEventLog();
  let courseId: Slug | undefined;
  let latest = 0;
  /** The latest proposal, as its card shows it; approval checks the record against it. */
  let shown: ShownProposal | undefined;
  let approved = false;

  const proposeCurriculum = proposeCurriculumTool({
    async propose(proposal) {
      if (approved) {
        return { refused: "The learner has approved the curriculum." };
      }
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
      });
      return { revision: latest };
    },
  });

  const tutor = createConversation({
    start: () =>
      options.backend.startSession({
        systemPrompt: options.systemPrompt,
        tools: [proposeCurriculum],
      }),
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
      const turn = tutor.started()
        ? messageTurn(text, latest)
        : draft === undefined
          ? openingTurn(text)
          : reviewTurn(text, draft.proposal);
      log.emit({ type: "learner", text });
      tutor.send(turn);
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
    "ask what you still need to know, or propose a curriculum with " +
    `propose_curriculum.]\n${text}`
  );
}

function reviewTurn(text: string, draft: ShownProposal): string {
  return (
    "[The learner is reviewing proposal 1, a curriculum proposed in an " +
    "earlier conversation that was not kept:\n" +
    `${JSON.stringify(draft)}\n` +
    "They have not approved it; their message follows. Allowed now: answer " +
    "them; if they ask for changes, call propose_curriculum with the whole " +
    "revised curriculum and its style note, keeping the ids of the units " +
    `you keep.]\n${text}`
  );
}

function messageTurn(text: string, proposal: number): string {
  const header =
    proposal === 0
      ? "[Message from the learner. Allowed now: reply, or propose a " +
        "curriculum with propose_curriculum.]"
      : `[Message from the learner about proposal ${proposal}, which they ` +
        "have not approved. Allowed now: answer them; if they ask for " +
        "changes, call propose_curriculum with the whole revised curriculum " +
        "and its style note.]";
  return `${header}\n${text}`;
}
