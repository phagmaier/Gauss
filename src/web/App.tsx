// The page (plan tasks 1.6, 2.11 and 2.26): the library, an intake, a course,
// a course's "What I know", or a unit's session, chosen by the address. Each
// view loads what it shows from the server.

import { Course } from "./Course.tsx";
import { Intake } from "./Intake.tsx";
import { Library } from "./Library.tsx";
import { useRoute } from "./route.ts";
import { Session } from "./Session.tsx";
import { WhatIKnow } from "./WhatIKnow.tsx";

export function App() {
  const route = useRoute();
  switch (route.view) {
    case "library":
      return <Library />;
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
          key={`${route.courseId}/${route.unitId}`}
          courseId={route.courseId}
          unitId={route.unitId}
        />
      );
  }
}
