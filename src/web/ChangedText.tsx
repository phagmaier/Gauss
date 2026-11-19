// A proposed text with what changed marked, sentence by sentence
// (compareSentences): each new sentence underlined, each dropped one listed
// under the text and struck through. The intake card's profile (piece 18)
// and the card of a proposed style note show it.

import { Fragment } from "react";
import type { SentenceChange } from "../shared/profile.ts";

export function ChangedText(props: { change: SentenceChange }) {
  const { sentences, dropped } = props.change;
  return (
    <>
      <p className="cs-t">
        {sentences.map((s, i) => (
          // Sentences can repeat, so their place is their key.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <Fragment key={i}>
            {i === 0 ? null : " "}
            {s.added ? <ins>{s.text}</ins> : s.text}
          </Fragment>
        ))}
      </p>
      {dropped.length === 0 ? null : (
        <p className="cs-gone">
          Dropped:{" "}
          {dropped.map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: as above
            <Fragment key={i}>
              {i === 0 ? null : " "}
              <s>{s}</s>
            </Fragment>
          ))}
        </p>
      )}
    </>
  );
}
