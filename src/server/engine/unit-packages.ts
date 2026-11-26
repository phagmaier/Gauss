// The tutor's package requests. With install_packages (task 3.11) the
// tutor asks for packages, which the learner installs or declines on a
// card; the request is kept in the unit's position, the install runs
// outside the chat's queue with the course's workspace closed to every
// other change, and the answer goes to the tutor in a turn of its own.
// An install whose result could not be saved says so on its card, where
// Retry saving saves that result without running the install again.
// Reopening shows the completed cards the thread lacks, an install whose
// result is still unsaved, and the request that waits. The unit chat keeps
// the running unit and the workspace's folder, read at each call; each
// action's guard and entry into its queue; and the course's workspace,
// whose queue admits a request and an install.

import { randomUUID } from "node:crypto";
import type { PageEvent } from "../../shared/events.ts";
import type {
  PackageCompletion,
  PackageReceipt,
  PackageRequest,
} from "../../shared/packages.ts";
import type { UnitPosition } from "../../shared/state.ts";
import type { PackageDesk } from "../tools/install-packages.ts";
import type { ChatResult } from "./conversation.ts";
import type { PackageInstaller } from "./packages.ts";
import type { UnitAgents } from "./unit-agents.ts";
import type { UnitHeader } from "./unit-header.ts";
import { packagesAnsweredEvent, type UnitRecord } from "./unit-record.ts";
import { packagesTurn, type Where } from "./unit-turns.ts";

/** The loaded unit, as the package requests read and change it. */
interface PackageUnit {
  record: Pick<
    UnitRecord,
    "position" | "finished" | "keepPackageRequest" | "completePackageRequest"
  >;
  agents: Pick<UnitAgents, "send">;
  header: Pick<UnitHeader, "waits">;
}

export interface UnitPackages<U extends PackageUnit> {
  desk: PackageDesk;
  /** The commands and folder a request's card shows, as they are now. */
  packagePreview(request: PackageRequest): PackageCompletion["preview"];
  /** The request's install runs, or its result still needs to be saved. */
  savingPackage(requestId: string): boolean;
  /** An install runs. */
  installing(): boolean;
  /** Why an install's result still needs to be saved, if it does. */
  unsavedInstall(): string | undefined;
  /**
   * Takes the install result the course's workspace recovered unsaved when
   * it was prepared, if it is this unit's.
   */
  recovered(receipt: PackageReceipt | undefined): void;
  /** The install that runs, if one does; `settled` waits for it. */
  installDone(): Promise<void> | undefined;
  /** Install on the request's card, inside the chat's queue. */
  installPackages(r: U, requestId: string): Promise<ChatResult>;
  /** "Not now" on the request's card, inside the chat's queue. */
  declinePackages(r: U, requestId: string): Promise<ChatResult>;
  /** Retry saving, inside the chat's queue, in the course's workspace. */
  retryPackageSave(
    r: U,
    workspace: string,
    requestId: string,
  ): Promise<ChatResult>;
  /** On reopening: the completed cards the thread did not keep, or not with their outcome. */
  restorePackages(completions: readonly PackageCompletion[]): void;
  /** On reopening: the card of an install whose result is still unsaved. */
  showUnsaved(): void;
  /** On reopening: the card of the request that waits, unless its install's result is unsaved. */
  showWaiting(position: UnitPosition): void;
}

export function createUnitPackages<U extends PackageUnit>({
  exclusive,
  running,
  folder,
  emit,
  events,
  unitId,
  now,
  installer,
  course,
  where,
  unitFinished,
  saveFailed,
}: {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  /** The unit once it is loaded. */
  running(): U | undefined;
  /** The course's workspace, once the unit's load has found it. */
  folder(): string | undefined;
  emit(event: PageEvent): void;
  events(): readonly PageEvent[];
  unitId: string;
  now(): Date;
  /** Installs the packages; only when the sandbox can run. */
  installer: PackageInstaller | undefined;
  /** The course's workspace, whose queue admits a request and an install. */
  course: {
    request<T>(work: () => Promise<T>): Promise<T | { refused: string }>;
    saveInstall(
      folder: string,
      receipt: PackageReceipt,
      save: (completion: PackageReceipt["completion"]) => Promise<boolean>,
    ): Promise<PackageReceipt["completion"]>;
    beginInstall(
      owner: string,
    ): Promise<{ done(): void } | { refused: string }>;
  };
  /** Where the unit given stands now, with the notes not yet given, which this takes. */
  where(r: U): Where;
  unitFinished: string;
  saveFailed: string;
}): UnitPackages<U> {
  /** The install that runs, by its request's id; `settled` waits for it. */
  let install: { requestId: string; done: Promise<void> } | undefined;
  /** The install ran, but its result still needs to be written to state.json. */
  let pendingInstall: PackageReceipt["completion"] | undefined;

  // Not while a question of the course is open: the install closes the
  // workspace, which an open question has closed already.
  const desk: PackageDesk = {
    request: (packages, signal) =>
      exclusive(async () => {
        const r = running();
        if (r === undefined) return { refused: "The unit is not open." };
        if (r.record.finished !== undefined) {
          return { refused: unitFinished };
        }
        return course.request(async () => {
          const request: PackageRequest = {
            id: randomUUID(),
            packages: [...packages],
            requestedAt: now().toISOString(),
          };
          // As for a proposal: a turn stopped meanwhile keeps nothing.
          signal?.throwIfAborted();
          await r.record.keepPackageRequest(request, () =>
            emit(requestedEvent(request)),
          );
          return { requested: true as const };
        });
      }),
  };

  function packagePreview(
    request: PackageRequest,
  ): PackageCompletion["preview"] {
    return {
      commands: installer?.commands(folder() ?? "", request.packages) ?? [],
      folder: folder() ?? "",
    };
  }

  /** The card that presents a package request. */
  function requestedEvent(
    request: PackageRequest,
    preview = packagePreview(request),
    historical?: true,
  ): PageEvent {
    return {
      type: "packages_requested",
      requestId: request.id,
      packages: request.packages,
      ...preview,
      ...(historical === undefined ? {} : { historical }),
    };
  }

  /** The request that waits, if it is this one, or why not. */
  function waitingRequest(r: U, requestId: string): PackageRequest | string {
    if (pendingInstall?.request.id === requestId) return saveFailed;
    const request = r.record.position.packageRequest;
    if (request === undefined || request.id !== requestId) {
      return "That request to install packages is not waiting.";
    }
    if (install?.requestId === requestId) {
      return "The packages are being installed.";
    }
    return request;
  }

  /**
   * Sends the turn that tells the tutor, from the notice the record kept
   * with the completion, only if no question is open and no other turn has
   * carried the notice first.
   */
  function tellPackageOutcome(r: U, completion: PackageCompletion): void {
    if (r.record.finished !== undefined) return;
    if (r.record.position.openQuestion !== undefined) return;
    const { id } = completion.request;
    r.agents.send({
      skip: () =>
        r.record.finished !== undefined ||
        r.record.position.openQuestion !== undefined ||
        !r.header.waits(
          (notice) => notice.kind === "packages" && notice.requestId === id,
        ),
      text: () => packagesTurn(where(r)),
    });
  }

  function showSaveFailure(completion: PackageCompletion): void {
    const { request, preview } = completion;
    if (
      !events().some(
        (event) =>
          event.type === "packages_requested" && event.requestId === request.id,
      )
    ) {
      emit(requestedEvent(request, preview, true));
    }
    emit({ type: "packages_save_failed", requestId: request.id });
  }

  /** A retry writes the result of the original command; it never runs it again. */
  async function recordInstall(
    r: U,
    workspace: string,
    completion: PackageReceipt["completion"],
  ): Promise<PackageReceipt["completion"] | undefined> {
    let saved: PackageReceipt["completion"];
    try {
      saved = await course.saveInstall(
        workspace,
        { unitId, completion },
        (outcome) => r.record.completePackageRequest(outcome),
      );
    } catch (error) {
      pendingInstall = completion;
      console.error("An install could not be recorded:", error);
      showSaveFailure(completion);
      return undefined;
    }
    pendingInstall = undefined;
    return saved;
  }

  /** Installs the request's packages outside the chat's queue. */
  function runInstall(
    r: U,
    request: PackageRequest,
    installer: PackageInstaller,
    workspace: string,
    claim: { done(): void },
  ): Promise<void> {
    const preview = packagePreview(request);
    return (async () => {
      const result = await installer.install(workspace, unitId, {
        request,
        preview,
      });
      await exclusive(async () => {
        const saved = await recordInstall(r, workspace, result);
        install = undefined;
        claim.done();
        if (saved !== undefined) tellPackageOutcome(r, saved);
      });
    })().catch((error: unknown) => {
      install = undefined;
      claim.done();
      console.error("An install could not be recorded:", error);
    });
  }

  return {
    desk,
    packagePreview,
    savingPackage: (requestId) =>
      install?.requestId === requestId ||
      pendingInstall?.request.id === requestId,
    installing: () => install !== undefined,
    unsavedInstall: () =>
      pendingInstall === undefined ? undefined : saveFailed,
    recovered(receipt) {
      if (receipt?.unitId === unitId) pendingInstall = receipt.completion;
    },
    installDone: () => install?.done,

    async installPackages(r, requestId) {
      const request = waitingRequest(r, requestId);
      if (typeof request === "string") return refused(request);
      // Read once: load, its only writer, does not run again once the unit
      // is loaded, so the folder after the await is the same.
      const workspace = folder();
      if (installer === undefined || workspace === undefined) {
        return refused(
          "Packages cannot be installed: the sandbox does not run.",
        );
      }
      const claim = await course.beginInstall(unitId);
      if ("refused" in claim) return refused(claim.refused);
      emit({ type: "packages_installing", requestId });
      install = {
        requestId,
        done: runInstall(r, request, installer, workspace, claim),
      };
      return { ok: true };
    },

    async declinePackages(r, requestId) {
      const request = waitingRequest(r, requestId);
      if (typeof request === "string") return refused(request);
      const completion: PackageCompletion = {
        request,
        preview: packagePreview(request),
        outcome: "declined",
      };
      if (await r.record.completePackageRequest(completion)) {
        tellPackageOutcome(r, completion);
      }
      return { ok: true };
    },

    async retryPackageSave(r, workspace, requestId) {
      const pending = pendingInstall;
      if (pending?.request.id !== requestId) {
        return refused("That package install does not need to be saved.");
      }
      const saved = await recordInstall(r, workspace, pending);
      if (saved === undefined) return refused(saveFailed);
      tellPackageOutcome(r, saved);
      return { ok: true };
    },

    restorePackages(completions) {
      if (completions.length === 0) return;
      const shown = new Map<
        string,
        Extract<PageEvent, { type: "packages_answered" }> | undefined
      >();
      for (const event of events()) {
        if (
          event.type === "packages_requested" &&
          !shown.has(event.requestId)
        ) {
          shown.set(event.requestId, undefined);
        } else if (
          event.type === "packages_answered" &&
          shown.has(event.requestId)
        ) {
          shown.set(event.requestId, event);
        }
      }
      for (const completion of completions) {
        const { request, preview, outcome, output } = completion;
        if (request.id === pendingInstall?.request.id) continue;
        const was = shown.get(request.id);
        if (!shown.has(request.id))
          emit(requestedEvent(request, preview, true));
        if (
          was === undefined ||
          was.outcome !== outcome ||
          was.output !== output
        ) {
          emit(packagesAnsweredEvent(completion));
        }
      }
    },

    showUnsaved() {
      if (pendingInstall !== undefined) showSaveFailure(pendingInstall);
    },

    showWaiting(position) {
      if (
        position.packageRequest !== undefined &&
        pendingInstall === undefined
      ) {
        emit(requestedEvent(position.packageRequest));
      }
    },
  };
}

function refused(error: string): ChatResult {
  return { ok: false, status: 409, error };
}
