// The Settings page (docs/prototype/25-settings.html, direction A), reached
// from the library's top line: the tutor's model for each backend's courses,
// saved as soon as one is picked, and the tutor's default style in one box
// to rewrite, as the Profile page's box is, with "Restore Gauss's text",
// Gauss's text in a fold under an edit, and the paragraph that stays fixed.
// A save of the box is refused if the instructions changed since the page
// loaded them, as a save in another tab does.

import { useEffect, useState } from "react";
import { BACKEND_TITLES, type BackendName } from "../shared/course.ts";
import {
  SettingsView,
  TEACHING_LIMIT,
  TeachingSaved,
  TUTOR_MODELS,
  type TutorModelOffer,
  TutorModelSaved,
} from "../shared/settings.ts";
import { getJson, postFor } from "./api.ts";
import { TopLine } from "./Frame.tsx";
import { paths } from "./route.ts";
import { textFoot } from "./text-foot.ts";

const BACKENDS: readonly BackendName[] = ["claude", "codex"];

export function Settings() {
  const [view, setView] = useState<SettingsView>();
  const [loadProblem, setLoadProblem] = useState<string>();

  useEffect(() => {
    void getJson("/api/settings", SettingsView).then((answer) => {
      if (answer.ok) setView(answer.data);
      else setLoadProblem(answer.error);
    });
  }, []);

  return (
    <div className="pg">
      <TopLine
        trail={[{ label: "Library", to: paths.library }]}
        here="Settings"
      />
      <div className="pg-scroll">
        <div className="pg-col">
          <h1 className="cv-title">Settings</h1>
          <p className="pg-lead">How Gauss's tutors work in every course.</p>
          {view === undefined ? (
            loadProblem === undefined ? null : (
              <p className="ph-note">{loadProblem}</p>
            )
          ) : (
            <>
              <TutorModels chosen={view.tutorModels} />
              <Teaching {...view.teaching} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TutorModels(props: { chosen: TutorModelSaved }) {
  const [chosen, setChosen] = useState(props.chosen);
  /** The pick being saved, shown checked until the server answers. */
  const [asking, setAsking] = useState<{
    backend: BackendName;
    model: string;
  }>();
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string>();

  async function choose(backend: BackendName, model: string) {
    setAsking({ backend, model });
    const answer = await postFor("/api/settings/tutor-model", TutorModelSaved, {
      backend,
      model,
    });
    setAsking(undefined);
    if (answer.ok) {
      setChosen(answer.data);
      setSaved(true);
      setProblem(undefined);
    } else {
      setSaved(false);
      setProblem(answer.error);
    }
  }

  return (
    <>
      <h2 className="pg-h">The tutor's model</h2>
      <p className="set-say">
        Each course's tutor runs on its course's backend. The planners, the
        grader and the judges keep their own models.
      </p>
      {BACKENDS.map((backend) => {
        const title = `${BACKEND_TITLES[backend]} courses`;
        const offers: readonly TutorModelOffer[] = TUTOR_MODELS[backend];
        return (
          <fieldset key={backend} className="set-mc">
            <legend className="set-k">{title}</legend>
            <div className="set-opts">
              {offers.map((offer) => {
                const shown =
                  asking?.backend === backend ? asking.model : chosen[backend];
                const on = shown === offer.id;
                return (
                  <label
                    key={offer.id}
                    className={on ? "set-opt on" : "set-opt"}
                  >
                    <input
                      type="radio"
                      name={`tutor-${backend}`}
                      checked={on}
                      disabled={asking !== undefined}
                      onChange={() => void choose(backend, offer.id)}
                    />
                    <span className="set-name">{offer.title}</span>
                    <span className="set-says">{offer.says}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      <p className={saved ? "set-applied on" : "set-applied"}>
        {saved ? "Saved. " : ""}A change applies from your next message in each
        open unit.
      </p>
      {problem === undefined ? null : <p className="qa-error">{problem}</p>}
    </>
  );
}

function Teaching(props: SettingsView["teaching"]) {
  const { gauss, fixed } = props;
  /** The learner's text on record, as last read or saved; none while they keep Gauss's. */
  const [saved, setSaved] = useState(props.text);
  const [text, setText] = useState(props.text ?? gauss);
  const [justSaved, setJustSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shown, setShown] = useState(false);
  const [problem, setProblem] = useState<string>();

  async function save() {
    setSaving(true);
    const answer = await postFor("/api/settings/teaching", TeachingSaved, {
      text,
      ...(saved === undefined ? {} : { was: saved }),
    });
    setSaving(false);
    if (answer.ok) {
      const kept = answer.data.text;
      setSaved(kept);
      // The response saves the submitted text, not edits made while waiting.
      setText((current) => (current === text ? (kept ?? gauss) : current));
      setJustSaved(true);
      setProblem(undefined);
    } else setProblem(answer.error);
  }

  const foot = textFoot(text, saved ?? gauss, justSaved, TEACHING_LIMIT);
  const isGauss = text.trim() === gauss;
  return (
    <>
      <h2 className="pg-h">How the tutor teaches</h2>
      <p className="set-say">
        Gauss's default style, which every course's tutor follows. Rewrite it or
        add to it. A course's own style note still adjusts it for that course.
        The rules Gauss relies on (its questions, grading, what counts as help,
        its tools) are not here and do not change.
      </p>
      <textarea
        className="field set-text"
        aria-label="How the tutor teaches"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setJustSaved(false);
        }}
      />
      <div className="pr-foot">
        <span>
          <span className="set-whose">
            {isGauss ? "Gauss's text" : "Your edit"}
          </span>
          {" · "}
          <span className={foot.over ? "over" : undefined}>{foot.count}</span>
          {foot.note === "" ? null : (
            <span className="pr-note"> · {foot.note}</span>
          )}
        </span>
        <span className="dp-btns">
          {isGauss ? null : (
            <button
              type="button"
              className="textbtn"
              onClick={() => {
                setText(gauss);
                setJustSaved(false);
                setProblem(undefined);
              }}
            >
              Restore Gauss's text
            </button>
          )}
          {foot.changed ? (
            <button
              type="button"
              className="textbtn"
              onClick={() => {
                setText(saved ?? gauss);
                setProblem(undefined);
              }}
            >
              Undo my changes
            </button>
          ) : null}
          <button
            type="button"
            className="btn sm"
            disabled={!foot.canSave || saving}
            onClick={() => void save()}
          >
            Save
          </button>
        </span>
      </div>
      {problem === undefined ? null : <p className="qa-error">{problem}</p>}
      {isGauss ? null : (
        <div className="set-fold">
          <button
            type="button"
            className="textbtn"
            aria-expanded={shown}
            onClick={() => setShown(!shown)}
          >
            {shown ? "Hide Gauss's text" : "Show Gauss's text"}
          </button>
          {shown ? <p className="set-gauss">{gauss}</p> : null}
        </div>
      )}
      <div className="set-fixed">
        <span className="set-fixed-k">
          Always follows it, and cannot be changed
        </span>
        <p className="set-fixed-t">{fixed}</p>
      </div>
    </>
  );
}
