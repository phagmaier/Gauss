// The page (plan tasks 1.6, 2.11, 2.26 and 5.8): the library, the learner
// profile, an intake, a course, its "What I know", a unit's session or
// its notes, chosen by the address. Each view loads its data from the server.

import { Course } from "./Course.tsx";
import { Intake } from "./Intake.tsx";
import { Library } from "./Library.tsx";
import { NotesReader } from "./Notes.tsx";
import { Profile } from "./Profile.tsx";
import { paths, useRoute } from "./route.ts";
import { Session } from "./Session.tsx";
import { WhatIKnow } from "./WhatIKnow.tsx";

export function App() {
  const route = useRoute();
  switch (route.view) {
    case "library":
      return <Library />;
    case "profile":
      return <Profile />;
    // A new key gives each intake and course a view of its own.
    case "intake":
      return <Intake key={route.intakeId} intakeId={route.intakeId} />;
    case "course":
      return <Course key={route.courseId} courseId={route.courseId} />;
    case "known":
      return <WhatIKnow key={route.courseId} courseId={route.courseId} />;
    case "unit":
      return (
        <Session
          key={paths.unit(route.courseId, route.unitId)}
          courseId={route.courseId}
          unitId={route.unitId}
        />
      );
    case "notes":
      return (
        <NotesReader
          key={paths.notes(route.courseId, route.unitId)}
          courseId={route.courseId}
          unitId={route.unitId}
        />
      );
  }
}
