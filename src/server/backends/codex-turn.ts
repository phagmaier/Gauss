import type { TeachingTool, ToolResult } from "../tools/tool.ts";
import type { BackendEvent, EngineTurn } from "./backend.ts";
import {
  type CodexAppServer,
  CodexRpcError,
  messageOf,
  type ServerMessage,
} from "./codex-rpc.ts";

type TurnEnd = Extract<BackendEvent, { type: "turn_end" }>;
type TurnMessage = {
  threadId: string;
  turnId?: string;
  turn?: { id: string; status: string; error?: { message: string } | null };
  item?: { id: string; type: string; tool?: string; text?: string };
  itemId?: string;
  delta?: string;
};

const TURN_OVER =
  "Your turn is over. End it now with an empty message. Do not call any more tools.";

export function runCodexTurn(options: {
  app: CodexAppServer;
  threadId: string;
  model: { model: string; effort: string; serviceTier: string };
  namespace: string;
  tools: ReadonlyMap<string, TeachingTool>;
  turn: EngineTurn;
  signal?: AbortSignal | undefined;
}) {
  const { app, threadId, model, namespace, tools, turn, signal } = options;
  const controller = new AbortController();
  const early: ServerMessage[] = [];
  const queue: BackendEvent[] = [];
  let wake: (() => void) | undefined;
  let outcome: TurnEnd | undefined;
  let turnId: string | undefined;
  let lastText: string | undefined;
  const textItems = new Set<string>();
  let userStopped = false;
  let interrupting: Promise<void> | undefined;
  let endingCall: string | undefined;
  let endingCallCompleted = false;
  let endingOutputRecorded = false;
  let toolCalls = Promise.resolve();
  let continuedAfterTool = false;

  function failed(error: unknown) {
    finish({ type: "turn_end", outcome: "error", error: messageOf(error) });
  }

  function finish(end: TurnEnd) {
    if (outcome !== undefined) return;
    outcome = end;
    signal?.removeEventListener("abort", stop);
    controller.abort();
    wake?.();
  }

  function emit(event: BackendEvent) {
    queue.push(event);
    wake?.();
  }

  function interrupt() {
    if (outcome !== undefined || turnId === undefined) return;
    interrupting ??= app.request("turn/interrupt", { threadId, turnId }).then(
      () => {},
      (error: unknown) => {
        // Codex marks the turn terminal before publishing turn/completed.
        // Let that notification settle a Stop in this gap.
        if (
          error instanceof CodexRpcError &&
          error.code === -32600 &&
          error.message === "no active turn to interrupt"
        )
          return;
        app.abort(error);
      },
    );
    return interrupting;
  }

  function stop() {
    if (outcome !== undefined) return;
    userStopped = true;
    // Do not show deltas already buffered but not yet delivered after Stop.
    queue.length = 0;
    controller.abort();
    return interrupt();
  }

  function stopContinuation() {
    continuedAfterTool = true;
    controller.abort();
    void interrupt();
  }

  function text(itemId: string, delta: string) {
    if (delta === "") return;
    if (endingOutputRecorded) stopContinuation();
    if (endingCall !== undefined) return;
    const separator =
      lastText !== undefined && lastText !== itemId ? "\n\n" : "";
    lastText = itemId;
    textItems.add(itemId);
    emit({ type: "text", text: separator + delta });
  }

  function identify(id: string) {
    if (turnId !== undefined) return;
    turnId = id;
    if (userStopped) void interrupt();
    for (const message of early) dispatch(message);
    early.length = 0;
  }

  async function callTool(message: ServerMessage) {
    if (message.id === undefined || outcome !== undefined) return;
    const call = message.params as {
      namespace: string | null;
      tool: string;
      callId: string;
      arguments: unknown;
    };
    if (userStopped || continuedAfterTool) return;
    if (endingOutputRecorded) {
      stopContinuation();
      return;
    }
    const tool =
      call.namespace === namespace ? tools.get(call.tool) : undefined;
    let result: ToolResult;
    if (endingCall !== undefined) {
      result = { status: "refused", text: TURN_OVER };
    } else if (tool === undefined) {
      result = { status: "refused", text: `No such tool: ${call.tool}` };
    } else {
      emit({ type: "tool_call", name: call.tool });
      result = await tool.run(call.arguments, controller.signal);
    }
    if (outcome !== undefined || controller.signal.aborted) return;
    if (result.endTurn === true) endingCall ??= call.callId;
    const image = result.status === "done" ? result.image : undefined;
    app.reply(message.id, {
      success: result.status === "done",
      contentItems: [
        {
          type: "inputText",
          text:
            result.endTurn === true
              ? `${result.text}\n\n${TURN_OVER}`
              : result.text,
        },
        ...(image === undefined
          ? []
          : [
              {
                type: "inputImage",
                imageUrl: `data:${image.mimeType};base64,${image.data.toString("base64")}`,
              },
            ]),
      ],
    });
  }

  function dispatch(message: ServerMessage) {
    if (message.id !== undefined && message.method !== "item/tool/call") {
      app.unsupported(message);
      return;
    }
    if (outcome !== undefined) return;
    const params = message.params as TurnMessage | undefined;
    if (params?.threadId !== threadId) return;
    if (message.method === "turn/started" && params.turn !== undefined) {
      identify(params.turn.id);
      return;
    }
    const id = params.turnId ?? params.turn?.id;
    if (id === undefined) return;
    if (turnId === undefined) {
      early.push(message);
      return;
    }
    if (id !== turnId) return;

    if (message.method === "turn/completed" && params.turn !== undefined) {
      const { status, error } = params.turn;
      if (status === "completed" || status === "interrupted") {
        let result: TurnEnd["outcome"] =
          status === "completed" ? "done" : "interrupted";
        if (
          continuedAfterTool ||
          (status === "completed" && endingCall !== undefined)
        ) {
          result = "ended_by_tool";
        }
        finish({
          type: "turn_end",
          outcome: userStopped ? "interrupted" : result,
        });
      } else {
        failed(error?.message ?? `Codex ended the turn with status ${status}.`);
      }
      return;
    }
    if (userStopped || continuedAfterTool) return;
    switch (message.method) {
      case "item/tool/call":
        toolCalls = toolCalls.then(() => callTool(message)).catch(app.abort);
        break;
      case "thread/tokenUsage/updated":
        // In the pinned CLI's sampling loop, token usage is sent after it
        // drains and records the tools' outputs. item/completed only means
        // the tool answered: the same model response can still emit items.
        if (endingCallCompleted) endingOutputRecorded = true;
        break;
      case "item/completed": {
        if (endingCall !== undefined && params.item?.id === endingCall) {
          endingCallCompleted = true;
        }
        const item = params.item;
        if (
          item?.type === "agentMessage" &&
          item.text &&
          !textItems.has(item.id)
        ) {
          text(item.id, item.text);
        }
        break;
      }
      case "item/started": {
        const item = params.item;
        if (item === undefined) break;
        if (
          endingOutputRecorded &&
          item.type !== "agentMessage" &&
          item.type !== "functionCallOutput"
        ) {
          stopContinuation();
        } else if (endingCall === undefined) {
          const name =
            item.type === "commandExecution"
              ? "exec_command"
              : item.type === "fileChange"
                ? "apply_patch"
                : item.type === "mcpToolCall"
                  ? item.tool
                  : undefined;
          if (name !== undefined) emit({ type: "tool_call", name });
        }
        break;
      }
      case "item/agentMessage/delta": {
        const { delta, itemId } = params;
        if (delta !== undefined && itemId !== undefined) text(itemId, delta);
        break;
      }
    }
  }

  signal?.addEventListener("abort", stop, { once: true });
  void app
    .request<{ turn: { id: string } }>("turn/start", {
      threadId,
      input: [{ type: "text", text: turn.text, text_elements: [] }],
      ...model,
    })
    .then(({ turn }) => identify(turn.id))
    .catch(failed);

  async function* events(): AsyncGenerator<BackendEvent> {
    while (true) {
      for (const event of queue) yield event;
      queue.length = 0;
      if (outcome !== undefined) {
        yield outcome;
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
  }

  return { dispatch, failed, stop, events };
}
