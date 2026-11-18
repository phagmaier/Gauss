// Installing a course's packages (architecture.md section 5): the tutor names
// Python packages with `install_packages`, the page shows them on a card, and
// on Install the engine runs a command it builds itself, the one command of a
// course with network access, open to the package index alone. What the
// tutor gives is checked to be names and version ranges only, so that no
// text of its own can become a URL, a path or an option of the command.

import { z } from "zod";
import { Slug, Timestamp } from "./course.ts";

/**
 * A package's name on the index, as PEP 508 has it: letters, digits, and
 * `.`, `_` or `-` between them. Never a path, a URL or an option.
 */
export const PackageName = z
  .string()
  .max(100)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/, {
    message:
      "Not a package name: a name has only letters, digits, and . _ or - between them, as pytest or scikit-learn. No URL, path, option, extra or marker.",
  });

/**
 * A version range in PEP 440's operators, clauses joined by commas, as
 * `>=8` or `>=2.0,<3`.
 */
export const VersionRange = z
  .string()
  .max(100)
  .regex(
    /^(?:~=|===|==|!=|<=|>=|<|>)[0-9A-Za-z.*+!_-]+(?:,(?:~=|===|==|!=|<=|>=|<|>)[0-9A-Za-z.*+!_-]+)*$/,
    {
      message:
        "Not a version range: give clauses such as >=8 or >=2.0,<3, with no spaces, joined by commas.",
    },
  );

/** One package the tutor asks for. */
export const PackageSpec = z.object({
  name: PackageName.describe("The package's name on PyPI, as pytest."),
  version: VersionRange.optional().describe(
    "A version range, as >=8 or >=2.0,<3. Leave it out for the latest.",
  ),
});
export type PackageSpec = z.infer<typeof PackageSpec>;

/** The most packages one request may name. */
export const PACKAGES_LIMIT = 20;

/** What the tutor gives `install_packages`. */
export const PackagesInput = z.object({
  packages: z
    .array(PackageSpec)
    .min(1)
    .max(PACKAGES_LIMIT)
    .refine(
      (packages) =>
        new Set(packages.map((p) => normalName(p.name))).size ===
        packages.length,
      { message: "A package is named twice." },
    )
    .describe("The Python packages the course's code needs."),
});
export type PackagesInput = z.infer<typeof PackagesInput>;

/**
 * A request waiting for the learner's answer, kept in the unit's position in
 * state.json, so a restart shows its card again.
 */
export const PackageRequest = z.object({
  /** The id the page answers it by. */
  id: z.string().min(1),
  packages: z.array(PackageSpec).min(1).max(PACKAGES_LIMIT),
  requestedAt: Timestamp,
});
export type PackageRequest = z.infer<typeof PackageRequest>;

/**
 * How a request ended. "declined": the learner pressed "Not now";
 * "withdrawn": the unit ended with the request still waiting.
 */
export const PackagesOutcome = z.enum([
  "installed",
  "failed",
  "declined",
  "withdrawn",
]);
export type PackagesOutcome = z.infer<typeof PackagesOutcome>;

/** The terminal card, recoverable even if both of its transcript lines are lost. */
export const PackageCompletion = z.object({
  request: PackageRequest,
  preview: z.object({
    commands: z.array(z.array(z.string())),
    folder: z.string(),
  }),
  outcome: PackagesOutcome,
  output: z.string().optional(),
});
export type PackageCompletion = z.infer<typeof PackageCompletion>;

/** The install outcome, kept beside the environment until state.json has it. */
export const PackageReceipt = z.object({
  unitId: Slug,
  completion: PackageCompletion.extend({
    outcome: PackagesOutcome.extract(["installed", "failed"]),
    output: z.string(),
  }),
});
export type PackageReceipt = z.infer<typeof PackageReceipt>;

/** The learner's answer to a request, as the page posts it. */
export const PackagesAnswer = z.object({ requestId: z.string().min(1) });
export type PackagesAnswer = z.infer<typeof PackagesAnswer>;

/** The package as the command names it: `pytest` or `pytest>=8`. */
export function requirement(spec: PackageSpec): string {
  return spec.version === undefined ? spec.name : `${spec.name}${spec.version}`;
}

/** PEP 503's normal form, under which two spellings name one package. */
function normalName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}
