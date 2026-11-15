// The minimal page (plan task 0.5): the Thread layout from
// docs/prototype/01-reading-chat.html, fed by the server's event stream.

import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { Hello, PageEvent } from "../shared/events.ts";
import type { AnswerSubmission } from "../shared/question.ts";
import { post } from "./api.ts";
import { QuestionCard } from "./QuestionCard.tsx";
import { emptyTimeline, type Item, reduce } from "./timeline.ts";

export function App() {
  const [timeline, dispatch] = useReducer(reduce, emptyTimeline);
  const [connected, setConnected] = useState(false);
  const [problem, setProblem] = useState<string>();
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.addEventListener("hello", (e: MessageEvent<string>) => {
      setConnected(true);
      dispatch({
        type: "hello",
        chatId: Hello.parse(JSON.parse(e.data)).chatId,
      });
    });
    source.onmessage = (e: MessageEvent<string>) => {
      dispatch({
        type: "event",
        index: Number(e.lastEventId.split(".")[1]),
        event: PageEvent.parse(JSON.parse(e.data)),
      });
    };
    // EventSource reconnects by itself and resumes after the last event.
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, []);

  // Follow the thread as it grows, unless the learner has scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
  });

  async function act(
    path: string,
    body?: unknown,
  ): Promise<string | undefined> {
    const refused = await post(path, body);
    setProblem(refused);
    return refused;
  }

  const started = timeline.last >= 0;
  return (
    <div className="th">
      <div
        className="th-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="th-col">
          {started ? null : (
            <div className="intro prose">
              <h1>The power rule</h1>
              <p>
                A short demonstration: the tutor explains one idea, then asks
                you a question about it.
              </p>
              <button
                type="button"
                className="btn"
                disabled={!connected}
                onClick={() => act("/api/start")}
              >
                Start
              </button>
            </div>
          )}
          {timeline.items.map((item) => (
            <ItemView
              key={item.key}
              item={item}
              onAnswer={(submission) => post("/api/answers", submission)}
            />
          ))}
          {timeline.busy && !timeline.tutorOpen ? (
            <div className="th-tutor">
              <span
                className="wait"
                role="status"
                aria-label="The tutor is writing"
              />
            </div>
          ) : null}
          {problem === undefined ? null : <p className="ph-note">{problem}</p>}
          {connected || timeline.chatId === null ? null : (
            <p className="ph-note">
              The connection to the server was lost. Retrying…
            </p>
          )}
        </div>
      </div>
      <div className="th-foot">
        <Composer
          enabled={started}
          busy={timeline.busy}
          onSend={(text) => act("/api/messages", { text })}
          onStop={() => act("/api/interrupt")}
        />
      </div>
    </div>
  );
}

function ItemView(props: {
  item: Item;
  onAnswer(submission: AnswerSubmission): Promise<string | undefined>;
}) {
  const { item } = props;
  switch (item.kind) {
    case "learner":
      return <div className="th-you">{item.text}</div>;
    case "tutor":
      return (
        <div className="th-tutor prose">
          {item.text
            .trim()
            .split(/\n{2,}/)
            .map((paragraph, i) => (
              // Paragraphs only grow at the end, so their order is stable.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <p key={i}>{paragraph}</p>
            ))}
        </div>
      );
    case "question":
      return (
        <QuestionCard
          question={item.question}
          graded={item.graded}
          onAnswer={props.onAnswer}
        />
      );
    case "note":
      return <p className="ph-note">{item.text}</p>;
  }
}

const SEND_ICON = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 14.5v-11M4.5 8 9 3.5 13.5 8" />
  </svg>
);
const STOP_ICON = (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" />
  </svg>
);

function Composer(props: {
  enabled: boolean;
  busy: boolean;
  onSend(text: string): Promise<string | undefined>;
  onStop(): void;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  // The box grows with its text, up to the limit set in the style sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the text changes
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  async function submit() {
    const message = text.trim();
    if (message === "" || props.busy || !props.enabled) return;
    if ((await props.onSend(message)) === undefined) setText("");
  }

  return (
    <form
      className="box"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={box}
        rows={1}
        value={text}
        placeholder="Message the tutor"
        aria-label="Message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {props.busy ? (
        <button
          type="button"
          className="send stop"
          aria-label="Stop the tutor"
          onClick={props.onStop}
        >
          {STOP_ICON}
        </button>
      ) : (
        <button
          type="submit"
          className="send"
          aria-label="Send"
          disabled={!props.enabled || text.trim() === ""}
        >
          {SEND_ICON}
        </button>
      )}
    </form>
  );
}
