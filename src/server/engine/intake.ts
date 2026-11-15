// The intake chat (brief.md, "How a course runs", steps 1 and 3). The learner
// says what they want to learn; the page asks that question itself, so the
// tutor's session starts with the learner's answer. The tutor proposes a
// curriculum with propose_curriculum, the learner pushes back by replying,
// and approves the latest revision on its card, which ends the intake.
//
// The first proposal creates the course, named by the proposal's title, and
// every proposal is stored as its draft curriculum. Before the first one,
// nothing is stored. Revision numbers and the conversation are in memory.

import type { Slug } from "../../shared/course.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { TutorBackend } from "../backends/backend.ts";
import type { DataRoot } from "../record/data-root.ts";
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

export function createIntake(options: {
  backend: TutorBackend;
  systemPrompt: string;
  dataRoot: DataRoot;
}): Intake {
  const { dataRoot } = options;
  const log = createEventLog();
  let courseId: Slug | undefined;
  let latest = 0;
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
      log.emit({
        type: "curriculum_proposed",
        courseId,
        revision: latest,
        title: proposal.title,
        units: proposal.units,
      });
      return { revision: latest };
    },
  });

  const tutor = createConversation({
    backend: options.backend,
    systemPrompt: options.systemPrompt,
    tools: [proposeCurriculum],
    log,
  });

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
        : openingTurn(text);
      log.emit({ type: "learner", text });
      tutor.send(turn);
      return { ok: true };
    },
    async approve(revision) {
      if (approved) {
        return { ok: false, status: 409, error: INTAKE_OVER };
      }
      if (courseId === undefined || latest === 0) {
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
        await dataRoot.approveCurriculum(courseId);
      } catch (error) {
        approved = false;
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

// --- Turns: a header saying what is allowed now, then the learner's text ---

function openingTurn(text: string): string {
  return (
    "[Start of the intake. The app has asked the learner what they want to " +
    "learn and what they already know; their answer follows. Allowed now: " +
    "ask what you still need to know, or propose a curriculum with " +
    `propose_curriculum.]\n${text}`
  );
}

function messageTurn(text: string, proposal: number): string {
  const header =
    proposal === 0
      ? "[Message from the learner. Allowed now: reply, or propose a " +
        "curriculum with propose_curriculum.]"
      : `[Message from the learner about proposal ${proposal}, which they ` +
        "have not approved. Allowed now: answer them; if they ask for " +
        "changes, call propose_curriculum with the whole revised curriculum.]";
  return `${header}\n${text}`;
}
