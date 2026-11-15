// The page (plan task 1.6): the library, an intake, or a course, chosen by
// the address. Each view loads what it shows from the server.

import { Course } from "./Course.tsx";
import { Intake } from "./Intake.tsx";
import { Library } from "./Library.tsx";
import { useRoute } from "./route.ts";

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
  }
}
