// The ask_question teaching tool (architecture.md section 4, "Question
// flow"). It posts the question and returns at once; the answer arrives as the
// tutor's next turn. Posting ends the tutor's turn, because the model does not
// reliably stop on its own (task 0.3). Whether a question may be posted now
// (the phase, a question already open, the objective it names) is the
// engine's rule, so a refusal comes from the board with its reason.

import { QuestionInput } from "../../shared/question.ts";
import { defineTool, type TeachingTool } from "./tool.ts";

/** Where questions are kept and shown. The engine provides it. */
export interface QuestionBoard {
  /** Stores the question and shows it to the learner, or says why not. */
  post(
    question: QuestionInput,
  ): Promise<{ id: string; number: number } | { refused: string }>;
}

export function askQuestionTool(board: QuestionBoard): TeachingTool {
  return defineTool({
    name: "ask_question",
    description:
      "Post one check question to the learner, on one objective of the " +
      'segment. It appears as a card in the conversation. A "choice" ' +
      "question gives choices and the letter of the correct one; a " +
      '"written" question asks for a proof, a derivation or an ' +
      "explanation, and gives a rubric, which a separate grader uses to " +
      "grade the answer without seeing this conversation. Posting ends your " +
      "turn, so say anything you want to say before calling this. The " +
      "learner's answer, already graded, arrives in the next message, not " +
      "as this tool's result, and that reply is for your feedback only; " +
      "the app asks for the next question after it. Only one question can " +
      "be open at a time, and only in the check.",
    input: QuestionInput,
    async run(question) {
      const result = await board.post(question);
      if ("refused" in result) {
        return { status: "refused", text: result.refused };
      }
      return {
        status: "done",
        text:
          `Posted as question ${result.number}. Your turn is over; the ` +
          "learner's answer will arrive in the next message.",
        endTurn: true,
      };
    },
  });
}
