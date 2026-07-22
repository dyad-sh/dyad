/**
 * Renderer projection for the main-authoritative user-input registry.
 *
 * This adapter is the only writer of the projection. It subscribes before
 * hydrating and uses per-request revisions so an event received while
 * getPending is in flight always wins over that snapshot.
 */
import { atom, type createStore } from "jotai";

import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import type {
  PendingUserInputPayload,
  UserInputDescriptorPayload,
  UserInputResponsePayload,
} from "@/ipc/types/user_input";
import { ipc as defaultIpc } from "@/ipc/types";
import { showError } from "@/lib/toast";

type UserInputOutcome =
  | "human"
  | "classifier-approved"
  | "timed-out"
  | "swept"
  | "superseded"
  | "dispatched";

const MAX_SETTLED_TOMBSTONES = 1_000;
const QUESTIONNAIRE_CONFIRMATION_MS = 2_000;

export type ProjectedUserInputRequest =
  | {
      status: "awaiting" | "armed" | "due";
      descriptor: UserInputDescriptorPayload;
      deadlineAt: number;
      classifier?: "none" | "racing" | "review";
      classifierReason?: string;
      followUpPrompt?: string;
    }
  | {
      status: "settled";
      requestId: string;
      outcome: UserInputOutcome;
      settledAt: number;
      descriptor?: UserInputDescriptorPayload;
      deadlineAt?: number;
      questionnaireSubmitted?: boolean;
    };

export type UserInputRequests = ReadonlyMap<string, ProjectedUserInputRequest>;
type LiveProjectedUserInputRequest = Exclude<
  ProjectedUserInputRequest,
  { status: "settled" }
>;

const writableUserInputRequestsAtom = atom<
  Map<string, ProjectedUserInputRequest>
>(new Map());
const writableRespondingRequestIdsAtom = atom<Set<string>>(new Set<string>());

// Public projection atoms are intentionally read-only. A rogue store.set call
// fails at runtime as well as at compile time, enforcing the single writer.
export const userInputRequestsAtom = atom<UserInputRequests>((get) =>
  get(writableUserInputRequestsAtom),
);
export const respondingRequestIdsAtom = atom<ReadonlySet<string>>((get) =>
  get(writableRespondingRequestIdsAtom),
);

export type UserInputProjectionIpc = Pick<typeof defaultIpc, "userInput"> & {
  events: Pick<typeof defaultIpc.events, "userInput">;
};

export interface UserInputChatStreamFacade {
  submit(request: {
    chatId: number;
    prompt: string;
    selectedComponents: [];
    requestedChatMode: "local-agent";
  }): void | Promise<void>;
}

export interface UserInputProjectionAdapter {
  start(): () => void;
  respond(
    requestId: string,
    response: UserInputResponsePayload,
  ): Promise<boolean>;
}

interface AdapterOptions {
  store: JotaiStore;
  ipcClient?: UserInputProjectionIpc;
  chatStream?: UserInputChatStreamFacade;
  showErrorToast?: (message: unknown) => unknown;
}

type JotaiStore = ReturnType<typeof createStore>;

const adapters = new WeakMap<JotaiStore, UserInputProjectionAdapter>();

function snapshotToProjection(
  snapshot: PendingUserInputPayload,
): LiveProjectedUserInputRequest {
  return {
    status: snapshot.status,
    descriptor: snapshot.descriptor,
    deadlineAt: snapshot.deadlineAt,
    classifier: snapshot.classifier,
    classifierReason: snapshot.classifierReason,
    followUpPrompt: snapshot.followUpPrompt,
  };
}

export function getUserInputProjectionAdapter({
  store,
  ipcClient = defaultIpc,
  chatStream,
  showErrorToast = showError,
}: AdapterOptions): UserInputProjectionAdapter {
  const existing = adapters.get(store);
  if (existing) return existing;

  let stop: (() => void) | undefined;
  let settledCleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let hydrationGeneration = 0;
  const revisions = new Map<string, number>();
  const pendingClassifications = new Map<
    string,
    { reason?: string; revision: number }
  >();
  const pendingFollowUps = new Map<
    string,
    { prompt: string; revision: number }
  >();
  const pendingResponses = new Map<string, UserInputResponsePayload>();
  const dispatchingFollowUps = new Set<string>();

  const markChanged = (requestId: string): number => {
    const revision = (revisions.get(requestId) ?? 0) + 1;
    revisions.set(requestId, revision);
    return revision;
  };

  const updateRequests = (
    update: (
      current: UserInputRequests,
    ) => Map<string, ProjectedUserInputRequest>,
  ) => {
    store.set(writableUserInputRequestsAtom, (current) => update(current));
  };

  const removeResponding = (requestId: string) => {
    store.set(writableRespondingRequestIdsAtom, (current) => {
      if (!current.has(requestId)) return current;
      const next = new Set<string>(current);
      next.delete(requestId);
      return next;
    });
  };

  const scheduleSettledCleanup = () => {
    if (!stop) return;
    if (settledCleanupTimer) clearTimeout(settledCleanupTimer);
    settledCleanupTimer = undefined;

    const now = Date.now();
    let nextExpiry = Number.POSITIVE_INFINITY;
    updateRequests((current) => {
      let next: Map<string, ProjectedUserInputRequest> | undefined;
      for (const [requestId, entry] of current) {
        if (entry.status !== "settled" || !entry.questionnaireSubmitted) {
          continue;
        }
        const expiresAt = entry.settledAt + QUESTIONNAIRE_CONFIRMATION_MS;
        if (expiresAt <= now) {
          next ??= new Map(current);
          next.delete(requestId);
        } else {
          nextExpiry = Math.min(nextExpiry, expiresAt);
        }
      }
      return next ?? (current as Map<string, ProjectedUserInputRequest>);
    });

    if (Number.isFinite(nextExpiry)) {
      settledCleanupTimer = setTimeout(
        scheduleSettledCleanup,
        Math.max(0, nextExpiry - Date.now()),
      );
    }
  };

  const dispatchDueFollowUp = async (requestId: string): Promise<void> => {
    if (dispatchingFollowUps.has(requestId)) return;
    const request = store.get(writableUserInputRequestsAtom).get(requestId);
    if (
      !request ||
      request.status !== "due" ||
      request.descriptor.kind !== "integration" ||
      !request.followUpPrompt ||
      !chatStream
    ) {
      return;
    }

    dispatchingFollowUps.add(requestId);
    try {
      await chatStream.submit({
        chatId: request.descriptor.chatId,
        prompt: request.followUpPrompt,
        selectedComponents: [],
        requestedChatMode: "local-agent",
      });
      await ipcClient.userInput.respond({
        requestId,
        response: { kind: "follow-up-dispatched" },
      });
    } catch (error) {
      showErrorToast(error);
    } finally {
      dispatchingFollowUps.delete(requestId);
    }
  };

  const dispatchAllDueFollowUps = () => {
    for (const [requestId, request] of store.get(
      writableUserInputRequestsAtom,
    )) {
      if (request.status === "due") void dispatchDueFollowUp(requestId);
    }
  };

  const hydrate = async (): Promise<void> => {
    const generation = ++hydrationGeneration;
    const baselineRevisions = new Map(revisions);
    const snapshots = await ipcClient.userInput.getPending(undefined);
    if (!stop || generation !== hydrationGeneration) return;

    updateRequests((current) => {
      const next = new Map<string, ProjectedUserInputRequest>();

      // Tombstones survive a refresh; unchanged live entries are replaced by
      // main's authoritative snapshot below.
      for (const [requestId, entry] of current) {
        const changedDuringHydration =
          (revisions.get(requestId) ?? 0) !==
          (baselineRevisions.get(requestId) ?? 0);
        if (entry.status === "settled" || changedDuringHydration) {
          next.set(requestId, entry);
        }
      }

      for (const snapshot of snapshots) {
        const requestId = snapshot.descriptor.requestId;
        const changedDuringHydration =
          (revisions.get(requestId) ?? 0) !==
          (baselineRevisions.get(requestId) ?? 0);
        const eventEntry = next.get(requestId);
        if (changedDuringHydration && eventEntry) {
          if (
            eventEntry.status === "settled" &&
            eventEntry.descriptor === undefined
          ) {
            next.set(requestId, {
              ...eventEntry,
              descriptor: snapshot.descriptor,
              deadlineAt: snapshot.deadlineAt,
            });
          }
          continue;
        }

        const projected = snapshotToProjection(snapshot);
        const classification = pendingClassifications.get(requestId);
        const followUp = pendingFollowUps.get(requestId);
        if (
          changedDuringHydration &&
          classification &&
          classification.revision === revisions.get(requestId) &&
          projected.status === "awaiting"
        ) {
          next.set(requestId, {
            ...projected,
            classifier: "review",
            classifierReason: classification.reason,
          });
        } else if (
          changedDuringHydration &&
          followUp &&
          followUp.revision === revisions.get(requestId)
        ) {
          next.set(requestId, {
            ...projected,
            status: "due",
            followUpPrompt: followUp.prompt,
          });
        } else if (!changedDuringHydration) {
          next.set(requestId, projected);
        }
      }
      return next;
    });
    dispatchAllDueFollowUps();
  };

  const adapter: UserInputProjectionAdapter = {
    start() {
      if (stop) return stop;
      const unsubscribes = [
        ipcClient.events.userInput.onRequested((descriptor) => {
          markChanged(descriptor.requestId);
          pendingClassifications.delete(descriptor.requestId);
          pendingFollowUps.delete(descriptor.requestId);
          updateRequests((current) => {
            const next = new Map(current);
            next.set(descriptor.requestId, {
              status: "awaiting",
              descriptor,
              deadlineAt: descriptor.deadlineAt,
              classifier: descriptor.classifier,
            });
            return next;
          });
        }),
        ipcClient.events.userInput.onClassified(({ requestId, reason }) => {
          const revision = markChanged(requestId);
          pendingClassifications.set(requestId, { reason, revision });
          updateRequests((current) => {
            const entry = current.get(requestId);
            if (!entry || entry.status !== "awaiting") return new Map(current);
            const next = new Map(current);
            next.set(requestId, {
              ...entry,
              classifier: "review",
              classifierReason: reason,
            });
            return next;
          });
        }),
        ipcClient.events.userInput.onSettled(({ requestId, outcome }) => {
          markChanged(requestId);
          pendingClassifications.delete(requestId);
          pendingFollowUps.delete(requestId);
          const pendingResponse = pendingResponses.get(requestId);
          pendingResponses.delete(requestId);
          removeResponding(requestId);
          updateRequests((current) => {
            const previous = current.get(requestId);
            const next = new Map(current);
            next.set(requestId, {
              status: "settled",
              requestId,
              outcome,
              settledAt: Date.now(),
              descriptor:
                previous && previous.status !== "settled"
                  ? previous.descriptor
                  : previous?.descriptor,
              deadlineAt: previous?.deadlineAt,
              questionnaireSubmitted:
                pendingResponse?.kind === "questionnaire" &&
                pendingResponse.answers !== null,
            });
            const tombstones = Array.from(next.entries()).filter(
              ([, entry]) => entry.status === "settled",
            );
            for (
              let index = 0;
              index < tombstones.length - MAX_SETTLED_TOMBSTONES;
              index++
            ) {
              next.delete(tombstones[index][0]);
            }
            return next;
          });
          scheduleSettledCleanup();
        }),
        ipcClient.events.userInput.onFollowUpDue(({ requestId, prompt }) => {
          const revision = markChanged(requestId);
          pendingFollowUps.set(requestId, { prompt, revision });
          updateRequests((current) => {
            const entry = current.get(requestId);
            if (!entry || entry.status === "settled") return new Map(current);
            const next = new Map(current);
            next.set(requestId, {
              ...entry,
              status: "due",
              followUpPrompt: prompt,
            });
            return next;
          });
          void dispatchDueFollowUp(requestId);
        }),
      ];

      stop = () => {
        ++hydrationGeneration;
        if (settledCleanupTimer) clearTimeout(settledCleanupTimer);
        settledCleanupTimer = undefined;
        for (const unsubscribe of unsubscribes.splice(0).reverse()) {
          unsubscribe();
        }
        stop = undefined;
      };
      scheduleSettledCleanup();
      void hydrate().catch((error) => showErrorToast(error));
      return stop;
    },

    async respond(requestId, response) {
      pendingResponses.set(requestId, response);
      store.set(writableRespondingRequestIdsAtom, (current) => {
        const next = new Set<string>(current);
        next.add(requestId);
        return next;
      });
      try {
        await ipcClient.userInput.respond({ requestId, response });
        if (response.kind === "integration") {
          removeResponding(requestId);
          updateRequests((current) => {
            const entry = current.get(requestId);
            if (
              !entry ||
              entry.status !== "awaiting" ||
              entry.descriptor.kind !== "integration"
            ) {
              return current as Map<string, ProjectedUserInputRequest>;
            }
            const followUpPrompt = response.provider
              ? `Continue. I have completed the ${response.provider} integration.`
              : entry.followUpPrompt;
            const next = new Map(current);
            next.set(requestId, {
              ...entry,
              status: "armed",
              followUpPrompt,
            });
            return next;
          });
        }
        return true;
      } catch (error) {
        pendingResponses.delete(requestId);
        if (isDyadError(error) && error.kind === DyadErrorKind.NotFound) {
          // Never expose a request main has already rejected as stale, even if
          // the best-effort authoritative refresh also fails.
          markChanged(requestId);
          updateRequests((current) => {
            const next = new Map(current);
            next.delete(requestId);
            return next;
          });
          removeResponding(requestId);
          try {
            await hydrate();
          } catch {
            // The stale response remains a NotFound regardless of whether the
            // best-effort projection refresh succeeds.
          }
          showErrorToast("request expired");
          return false;
        }
        removeResponding(requestId);
        showErrorToast(error);
        return false;
      }
    },
  };

  adapters.set(store, adapter);
  return adapter;
}
