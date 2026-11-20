// An artifact in the side pane (05-side-pane.html), in a frame that runs its
// scripts in an origin of its own. When the aid's script stops with an
// error, the pane says so above the aid and offers to send the error to the
// tutor as the learner's message (artifact.ts).

import { useLayoutEffect, useRef, useState } from "react";
import type { ArtifactReport } from "../shared/artifact.ts";
import type { ArtifactItem } from "../shared/timeline.ts";
import { errorMessage, frameReport } from "./artifact.ts";
import { SidePane } from "./Frame.tsx";

const enc = encodeURIComponent;

/** Keyed by the artifact's file, so a report belongs to the one frame that sent it. */
export function ArtifactPane(props: {
  courseId: string;
  artifact: ArtifactItem;
  /** Whether the unit takes a message: as for the message box. */
  enabled: boolean;
  /** The tutor is writing, so a message waits until it has finished. */
  busy: boolean;
  /** Posts the message; the reason when it is refused. */
  onSend(text: string): Promise<string | undefined>;
  onClose(): void;
}) {
  const { artifact } = props;
  const frame = useRef<HTMLIFrameElement>(null);
  /** The aid's first error; the frame reports no more. */
  const [report, setReport] = useState<ArtifactReport>();
  const [sending, setSending] = useState<
    "sending" | "sent" | { refused: string }
  >();

  // Listening before the frame's document can load, so its first error is heard.
  useLayoutEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const received = frameReport(event, frame.current?.contentWindow);
      if (received !== undefined) setReport((first) => first ?? received);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function send(text: string) {
    setSending("sending");
    const refused = await props.onSend(text);
    setSending(refused === undefined ? "sent" : { refused });
  }

  return (
    <SidePane
      title={artifact.title}
      subtitle="From the tutor"
      onClose={props.onClose}
    >
      <div className="sv-aid">
        {report === undefined ? null : (
          <div className="sv-aid-error" role="alert">
            <p className="sv-aid-say">
              This aid stopped with an error
              {report.line > 0
                ? ` at line ${report.line}, column ${report.column}`
                : ""}
              :
            </p>
            <pre>{report.message}</pre>
            <p className="sv-aid-act">
              <button
                type="button"
                className="btn sm"
                disabled={
                  !props.enabled ||
                  props.busy ||
                  sending === "sending" ||
                  sending === "sent"
                }
                onClick={() => void send(errorMessage(artifact, report))}
              >
                Send the error to the tutor
              </button>
              {sending === "sent" ? (
                <span>Sent.</span>
              ) : typeof sending === "object" ? (
                <span>{sending.refused}</span>
              ) : props.enabled && props.busy ? (
                <span>It can be sent once the tutor has finished.</span>
              ) : null}
            </p>
          </div>
        )}
        <iframe
          ref={frame}
          src={`/api/courses/${enc(props.courseId)}/artifacts/${enc(artifact.file)}`}
          // Scripts run, with an origin of their own; the artifact's
          // policy keeps it from the network (task 3.6).
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title={artifact.title}
        />
      </div>
    </SidePane>
  );
}
