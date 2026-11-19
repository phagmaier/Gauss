// The Profile page (docs/prototype/18-profile.html; task 5.8), reached from
// the library's top line: what the learner profile is for, its text in one
// box to edit, with its length against the limit and Save, and the finished
// courses a new course's planner is given with it, which come from the
// record and are not kept in the text. A save is refused if the profile
// changed since the page loaded it, as an approval in another tab can.

import { useEffect, useState } from "react";
import { ProfileSaved, ProfileView } from "../shared/profile.ts";
import { getJson, postFor } from "./api.ts";
import { TopLine } from "./Frame.tsx";
import { profileFoot } from "./profile.ts";
import { paths } from "./route.ts";

export function Profile() {
  const [view, setView] = useState<ProfileView>();
  /** The text on record, as last read or saved; none when there is no profile. */
  const [saved, setSaved] = useState<string>();
  const [text, setText] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    void getJson("/api/profile", ProfileView).then((answer) => {
      if (answer.ok) {
        setView(answer.data);
        setSaved(answer.data.text);
        setText(answer.data.text ?? "");
      } else setProblem(answer.error);
    });
  }, []);

  async function save() {
    setSaving(true);
    const answer = await postFor("/api/profile", ProfileSaved, {
      text,
      ...(saved === undefined ? {} : { was: saved }),
    });
    setSaving(false);
    if (answer.ok) {
      setSaved(answer.data.text);
      setText(answer.data.text);
      setJustSaved(true);
      setProblem(undefined);
    } else setProblem(answer.error);
  }

  const foot = profileFoot(text, saved ?? "", justSaved);
  return (
    <div className="pg">
      <TopLine
        trail={[{ label: "Library", to: paths.library }]}
        here="Profile"
      />
      <div className="pg-scroll">
        <div className="pg-col">
          <h1 className="cv-title">Profile</h1>
          <p className="pg-lead">
            What every course's planner and tutor are told about you. A planner
            proposes changes with a curriculum, and they are saved only when you
            approve it. You can edit it here at any time.
          </p>
          {view === undefined ? (
            problem === undefined ? null : (
              <p className="ph-note">{problem}</p>
            )
          ) : (
            <>
              <textarea
                className="field pr-text"
                aria-label="Your profile"
                placeholder="What holds about you in every course: your background, what you know, and how you like to be taught."
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setJustSaved(false);
                }}
              />
              <div className="pr-foot">
                <span>
                  <span className={foot.over ? "over" : undefined}>
                    {foot.count}
                  </span>
                  {foot.note === "" ? null : (
                    <span className="pr-note"> · {foot.note}</span>
                  )}
                </span>
                <span className="dp-btns">
                  {foot.changed ? (
                    <button
                      type="button"
                      className="textbtn"
                      onClick={() => {
                        setText(saved ?? "");
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
              {problem === undefined ? null : (
                <p className="qa-error">{problem}</p>
              )}
              <h2 className="pg-h">Finished courses</h2>
              <p className="cal-lead">
                A new course's planner is given these titles with the text
                above. They come from your record and are not kept in the text.
              </p>
              {view.finished.length === 0 ? (
                <p className="cal-lead">No course is finished yet.</p>
              ) : (
                <ul className="pr-list">
                  {view.finished.map((course) => (
                    <li key={course.id} className="pr-item">
                      {course.title}
                      {course.oneOff ? (
                        <span className="pr-kind">One-off</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
