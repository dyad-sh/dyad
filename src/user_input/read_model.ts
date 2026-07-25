/**
 * Renderer read model for the main-authoritative user-input registry.
 *
 * This adapter is the only writer of the renderer read model. It subscribes
 * before
 * hydrating and uses per-request revisions so an event received while
 * getPending is in flight always wins over that snapshot.
 *
 * Machine dependency graph: user_input -> chat_stream facade. The concrete
 * facade is injected at the application composition root; this module never
 * imports the chat-stream manager or controller.
 */
import type { createStore } from "jotai";

import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import type {
  PendingUserInputPayload,
  UserInputDescriptorPayload,
  UserInputResponsePayload,
} from "@/ipc/types/user_input";
import { ipc as defaultIpc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { createLateBinding } from "@/state_machines/late_binding";
import { SnapshotStore } from "@/state_machines/snapshot_store";
import { TaskScope } from "@/state_machines/task_scope";

type UserInputOutcome =
  | "human"
  | "classifier-approved"
  | "timed-out"
  | "swept"
  | "superseded"
  | "dispatched"
  | "rejected";

const MAX_SETTLED_TOMBSTONES = 1_000;
const QUESTIONNAIRE_CONFIRMATION_MS = 2_000;

export type UserInputRequest =
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

export type UserInputRequests = ReadonlyMap<string, UserInputRequest>;
type LiveUserInputRequest = Exclude<UserInputRequest, { status: "settled" }>;

export interface UserInputReadModelSnapshot {
  requests: UserInputRequests;
  respondingRequestIds: ReadonlySet<string>;
}

const EMPTY_READ_MODEL: UserInputReadModelSnapshot = {
  requests: new Map(),
  respondingRequestIds: new Set(),
};

export type UserInputReadModelIpc = Pick<typeof defaultIpc, "userInput"> & {
  events: Pick<typeof defaultIpc.events, "userInput">;
};

export interface UserInputChatStreamFacade {
  submit(request: {
    requestId: string;
    chatId: number;
    prompt: string;
    selectedComponents: [];
    requestedChatMode: "local-agent";
  }): { accepted: boolean } | Promise<{ accepted: boolean }>;
}

export interface UserInputReadModel {
  getSnapshot(): UserInputReadModelSnapshot;
  subscribe(listener: () => void): () => void;
  start(): () => void;
  configureChatStream(chatStream: UserInputChatStreamFacade): void;
  respond(
    requestId: string,
    response: UserInputResponsePayload,
  ): Promise<boolean>;
}

interface AdapterOptions {
  store: JotaiStore;
  ipcClient?: UserInputReadModelIpc;
  chatStream?: UserInputChatStreamFacade;
  showErrorToast?: (message: unknown) => unknown;
}

type JotaiStore = ReturnType<typeof createStore>;

const readModels = new WeakMap<JotaiStore, UserInputReadModel>();

function snapshotToReadModel(
  snapshot: PendingUserInputPayload,
): LiveUserInputRequest {
  return {
    status: snapshot.status,
    descriptor: snapshot.descriptor,
    deadlineAt: snapshot.deadlineAt,
    classifier: snapshot.classifier,
    classifierReason: snapshot.classifierReason,
    followUpPrompt: snapshot.followUpPrompt,
  };
}

export function getUserInputReadModel({
  store,
  ipcClient = defaultIpc,
  chatStream,
  showErrorToast = showError,
}: AdapterOptions): UserInputReadModel {
  const existing = readModels.get(store);
  if (existing) {
    if (chatStream) existing.configureChatStream(chatStream);
    return existing;
  }

  let stop: (() => void) | undefined;
  let activeTasks: TaskScope<string> | undefined;
  let hydrationGeneration = 0;
  const revisions = new Map<string, number>();
  const pendingClassifications = new Map<
    string,
    { reason?: string; revision: number }
  >();
  const pendingArmed = new Map<
    string,
    { followUpPrompt: string; revision: number }
  >();
  const pendingFollowUps = new Map<
    string,
    { prompt: string; revision: number }
  >();
  const pendingResponses = new Map<string, UserInputResponsePayload>();
  const dispatchingFollowUps = new Set<string>();
  const chatStreamBinding =
    createLateBinding<UserInputChatStreamFacade>("replaceable");
  if (chatStream) chatStreamBinding.configure(chatStream);
  const readModelStore = new SnapshotStore<UserInputReadModelSnapshot>(
    EMPTY_READ_MODEL,
  );

  const markChanged = (requestId: string): number => {
    const revision = (revisions.get(requestId) ?? 0) + 1;
    revisions.set(requestId, revision);
    return revision;
  };

  const updateRequests = (
    update: (current: UserInputRequests) => UserInputRequests,
  ) => {
    const current = readModelStore.getSnapshot();
    const requests = update(current.requests);
    if (requests === current.requests) return;
    readModelStore.setState({ ...current, requests });
  };

  const updateRequestsAndRemoveResponding = (
    requestId: string,
    update: (current: UserInputRequests) => UserInputRequests,
  ) => {
    const current = readModelStore.getSnapshot();
    const requests = update(current.requests);
    const wasResponding = current.respondingRequestIds.has(requestId);
    if (requests === current.requests && !wasResponding) return;
    const respondingRequestIds = new Set(current.respondingRequestIds);
    respondingRequestIds.delete(requestId);
    readModelStore.setState({ requests, respondingRequestIds });
  };

  const removeResponding = (requestId: string) => {
    const current = readModelStore.getSnapshot();
    if (!current.respondingRequestIds.has(requestId)) return;
    const next = new Set(current.respondingRequestIds);
    next.delete(requestId);
    readModelStore.setState({ ...current, respondingRequestIds: next });
  };

  const scheduleSettledCleanup = () => {
    const tasks = activeTasks;
    if (!tasks) return;
    tasks.remove("settled-cleanup");

    const now = Date.now();
    let nextExpiry = Number.POSITIVE_INFINITY;
    updateRequests((current) => {
      let next: Map<string, UserInputRequest> | undefined;
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
      return next ?? (current as Map<string, UserInputRequest>);
    });

    if (Number.isFinite(nextExpiry)) {
      const timer = setTimeout(
        scheduleSettledCleanup,
        Math.max(0, nextExpiry - Date.now()),
      );
      tasks.replace("settled-cleanup", () => clearTimeout(timer));
    }
  };

  const dispatchDueFollowUp = async (requestId: string): Promise<void> => {
    if (dispatchingFollowUps.has(requestId)) return;
    const request = readModelStore.getSnapshot().requests.get(requestId);
    if (
      !request ||
      request.status !== "due" ||
      request.descriptor.kind !== "integration" ||
      !request.followUpPrompt
    ) {
      return;
    }
    let chatStream: UserInputChatStreamFacade;
    try {
      chatStream = chatStreamBinding.get();
    } catch {
      activeTasks?.replace(
        `follow-up:${requestId}`,
        chatStreamBinding.onConfigured(
          () => void dispatchDueFollowUp(requestId),
          showErrorToast,
        ),
      );
      return;
    }
    activeTasks?.remove(`follow-up:${requestId}`);

    dispatchingFollowUps.add(requestId);
    try {
      const result = await chatStream.submit({
        requestId,
        chatId: request.descriptor.chatId,
        prompt: request.followUpPrompt,
        selectedComponents: [],
        requestedChatMode: "local-agent",
      });
      if (!result.accepted) return;
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
    for (const [requestId, request] of readModelStore.getSnapshot().requests) {
      if (request.status === "due") {
        void dispatchDueFollowUp(requestId);
      }
    }
  };

  const hydrate = async (): Promise<void> => {
    const generation = ++hydrationGeneration;
    const baselineRevisions = new Map(revisions);
    const snapshots = await ipcClient.userInput.getPending(undefined);
    if (!stop || generation !== hydrationGeneration) return;

    updateRequests((current) => {
      const next = new Map<string, UserInputRequest>();

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

        const projected = snapshotToReadModel(snapshot);
        const classification = pendingClassifications.get(requestId);
        const armed = pendingArmed.get(requestId);
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
          armed &&
          armed.revision === revisions.get(requestId) &&
          (projected.status === "awaiting" || projected.status === "armed") &&
          projected.descriptor.kind === "integration"
        ) {
          next.set(requestId, {
            ...projected,
            status: "armed",
            followUpPrompt: armed.followUpPrompt,
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

  const readModel: UserInputReadModel = {
    getSnapshot: readModelStore.getSnapshot,
    subscribe: readModelStore.subscribe,
    configureChatStream(nextChatStream) {
      chatStreamBinding.configure(nextChatStream);
      dispatchAllDueFollowUps();
    },

    start() {
      if (stop) return stop;
      const tasks = new TaskScope<string>();
      activeTasks = tasks;
      const handleWindowFocus = () => dispatchAllDueFollowUps();
      window.addEventListener("focus", handleWindowFocus);
      tasks.replace("window-focus", () =>
        window.removeEventListener("focus", handleWindowFocus),
      );
      const subscriptions = [
        [
          "requested",
          ipcClient.events.userInput.onRequested((descriptor) => {
            markChanged(descriptor.requestId);
            pendingClassifications.delete(descriptor.requestId);
            pendingArmed.delete(descriptor.requestId);
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
        ],
        [
          "armed",
          ipcClient.events.userInput.onArmed(
            ({ requestId, followUpPrompt }) => {
              const revision = markChanged(requestId);
              pendingArmed.set(requestId, { followUpPrompt, revision });
              updateRequestsAndRemoveResponding(requestId, (current) => {
                const entry = current.get(requestId);
                if (
                  !entry ||
                  entry.status !== "awaiting" ||
                  entry.descriptor.kind !== "integration"
                ) {
                  return current;
                }
                const next = new Map(current);
                next.set(requestId, {
                  ...entry,
                  status: "armed",
                  followUpPrompt,
                });
                return next;
              });
            },
          ),
        ],
        [
          "classified",
          ipcClient.events.userInput.onClassified(({ requestId, reason }) => {
            const revision = markChanged(requestId);
            pendingClassifications.set(requestId, { reason, revision });
            updateRequests((current) => {
              const entry = current.get(requestId);
              if (!entry || entry.status !== "awaiting") return current;
              const next = new Map(current);
              next.set(requestId, {
                ...entry,
                classifier: "review",
                classifierReason: reason,
              });
              return next;
            });
          }),
        ],
        [
          "settled",
          ipcClient.events.userInput.onSettled(({ requestId, outcome }) => {
            markChanged(requestId);
            pendingClassifications.delete(requestId);
            pendingArmed.delete(requestId);
            pendingFollowUps.delete(requestId);
            const pendingResponse = pendingResponses.get(requestId);
            pendingResponses.delete(requestId);
            updateRequestsAndRemoveResponding(requestId, (current) => {
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
                  outcome === "human" &&
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
        ],
        [
          "follow-up-due",
          ipcClient.events.userInput.onFollowUpDue(({ requestId, prompt }) => {
            const revision = markChanged(requestId);
            pendingFollowUps.set(requestId, { prompt, revision });
            updateRequests((current) => {
              const entry = current.get(requestId);
              if (!entry || entry.status === "settled") return current;
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
        ],
      ] satisfies ReadonlyArray<readonly [string, () => void]>;
      for (const [key, unsubscribe] of subscriptions) {
        tasks.replace(`subscription:${key}`, unsubscribe);
      }

      stop = () => {
        ++hydrationGeneration;
        try {
          tasks.dispose();
        } finally {
          if (activeTasks === tasks) activeTasks = undefined;
          stop = undefined;
        }
      };
      scheduleSettledCleanup();
      void hydrate().catch((error) => showErrorToast(error));
      return stop;
    },

    async respond(requestId, response) {
      pendingResponses.set(requestId, response);
      const current = readModelStore.getSnapshot();
      if (!current.respondingRequestIds.has(requestId)) {
        const next = new Set(current.respondingRequestIds);
        next.add(requestId);
        readModelStore.setState({ ...current, respondingRequestIds: next });
      }
      try {
        await ipcClient.userInput.respond({ requestId, response });
        return true;
      } catch (error) {
        pendingResponses.delete(requestId);
        if (isDyadError(error) && error.kind === DyadErrorKind.NotFound) {
          // Never expose a request main has already rejected as stale, even if
          // the best-effort authoritative refresh also fails.
          markChanged(requestId);
          updateRequestsAndRemoveResponding(requestId, (current) => {
            const next = new Map(current);
            next.delete(requestId);
            return next;
          });
          try {
            await hydrate();
          } catch {
            // The stale response remains a NotFound regardless of whether the
            // best-effort read-model refresh succeeds.
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

  readModels.set(store, readModel);
  return readModel;
}
