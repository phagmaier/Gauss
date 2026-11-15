// The ask_question teaching tool (architecture.md section 4, "Question
// flow"). It posts the question and returns at once; the answer arrives as the
// tutor's next turn. Posting ends the tutor's turn, because the model does not
// reliably stop on its own (task 0.3).

import { ChoiceQuestionInput } from "../../shared/question.ts";
import { defineTool, type TeachingTool } from "./tool.ts";

/** Where questions are kept and shown. The engine provides it. */
export interface QuestionBoard {
  /** The id of the question awaiting an answer, if there is one. */
  openQuestionId(): string | undefined;
  /** Stores the question, shows it to the learner, and returns its id. */
  post(question: ChoiceQuestionInput): string;
}

export function askQuestionTool(board: QuestionBoard): TeachingTool {
  return defineTool({
    name: "ask_question",
    description:
      "Post one multiple-choice check question to the learner. It appears as " +
      "a card in the conversation. Posting ends your turn, so say anything " +
      "you want to say before calling this. The learner's answer, already " +
      "graded, arrives in the next message, not as this tool's result. Only " +
      "one question can be open at a time.",
    input: ChoiceQuestionInput,
    run(question) {
      const open = board.openQuestionId();
      if (open !== undefined) {
        return {
          status: "refused",
          text: `Question ${open} is still open. End your turn and wait for the learner's answer.`,
        };
      }
      const id = board.post(question);
      return {
        status: "done",
        text: `Posted as ${id}. Your turn is over; the learner's answer will arrive in the next message.`,
        endTurn: true,
      };
    },
  });
}
