import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import {
  useDistributedMachine,
  useRemoteMachineClient,
} from "@/distributed_machines/react";
import { showError } from "@/lib/toast";
import {
  CLOSED_STATE,
  type PreviewEvent,
  type PreviewState,
} from "@/version_preview/state";
import {
  projectVersionPreview,
  type VersionPreviewProjection,
} from "@/version_preview/projection";
import { versionPreviewClientDefinition } from "@/version_preview/client_definition";
import { combineVersionPreviewState } from "@/version_preview/presentation_store";
import { useVersionPreviewPresentationStore } from "@/version_preview/VersionPreviewProvider";
import { useVersionPreviewWindowInterestClient } from "@/version_preview/VersionPreviewProvider";
import {
  versionPreviewKey,
  type VersionPreviewIntentEvent,
} from "@/version_preview/transport";

const NULL_APP_ID = 0;

function operationId(): string {
  return `version-preview:${globalThis.crypto.randomUUID()}`;
}

function toIntent(
  event: PreviewEvent,
  id: string,
): VersionPreviewIntentEvent | null {
  switch (event.type) {
    case "CLOSE":
    case "RETRY_RETURN":
      return { type: event.type, operationId: id };
    case "APP_CHANGED":
      return { ...event, operationId: id };
    case "SELECT_VERSION":
      return { ...event, operationId: id };
    case "SWITCH_BRANCH":
      return { type: event.type, branch: event.branch, operationId: id };
    case "RESTORE":
      return {
        type: event.type,
        versionId: event.versionId,
        expectedHeadOid: event.expectedHeadOid,
        currentChatMessageId: event.currentChatMessageId,
        operationId: id,
      };
    case "RESTORE_TO_MESSAGE":
      return {
        type: event.type,
        chatId: event.chatId,
        messageId: event.messageId,
        restoreCodebase: event.restoreCodebase,
        operationId: id,
      };
    case "OPEN":
    case "CLOSE_VERSION_DIFF":
    case "VIEW_VERSION_DIFF":
    case "SELECT_DIFF_FILE":
      return null;
    case "ORIGIN_RESOLVED":
    case "ORIGIN_RESOLUTION_FAILED":
    case "CHECKOUT_SUCCEEDED":
    case "CHECKOUT_FAILED":
    case "RESTORE_SUCCEEDED":
    case "RESTORE_FAILED":
    case "RESTORE_RECOVERY_REQUIRED":
    case "RETURN_SUCCEEDED":
    case "RETURN_FAILED":
    case "SWITCH_BRANCH_SUCCEEDED":
    case "SWITCH_BRANCH_FAILED":
      throw new Error(`${event.type} is a host-only version preview event`);
  }
}

export function useVersionPreview(appId: number | null): {
  state: PreviewState;
  projection: VersionPreviewProjection;
  isPaneVisible: boolean;
  send: (event: PreviewEvent) => void;
  sendAndWaitForMutation: (event: PreviewEvent) => Promise<void>;
} {
  const routedAppId = appId ?? NULL_APP_ID;
  const key = versionPreviewKey(routedAppId);
  const presentationStore = useVersionPreviewPresentationStore();
  const windowInterest = useVersionPreviewWindowInterestClient();
  const selectionQueue = useRef<Promise<void>>(Promise.resolve());
  const client = useRemoteMachineClient();
  const actor = client.actor(versionPreviewClientDefinition, key);
  const remote = useDistributedMachine(versionPreviewClientDefinition, key);
  const presentation = useSyncExternalStore(
    useCallback(
      (listener) => presentationStore.subscribe(routedAppId, listener),
      [presentationStore, routedAppId],
    ),
    useCallback(
      () => presentationStore.getSnapshot(routedAppId),
      [presentationStore, routedAppId],
    ),
  );
  const state =
    appId === null
      ? CLOSED_STATE
      : combineVersionPreviewState(appId, remote.state.state, presentation);
  const isPaneVisible =
    appId !== null && presentationStore.isPaneVisible(appId);

  const dispatchNow = useCallback(
    async (
      event: PreviewEvent,
      waitForSettlement: boolean,
      selectionEpoch?: number,
    ): Promise<void> => {
      if (appId === null) return;
      const isCleanup = event.type === "CLOSE";
      const releaseSelectionInterest = async (id: string) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await windowInterest.release(appId, id, { type: "close" });
            return;
          } catch (error) {
            if (attempt === 2) throw error;
          }
        }
      };
      if (event.type === "OPEN") {
        await windowInterest.acquire(appId);
        presentationStore.send(appId, event);
        return;
      }
      let acquiredSelectionInterest = false;
      let selectionAccepted = false;
      if (event.type === "SELECT_VERSION") {
        acquiredSelectionInterest = (await windowInterest.acquire(appId))
          .acquired;
        if (
          selectionEpoch !== undefined &&
          !windowInterest.isSelectionEpochCurrent(appId, selectionEpoch)
        ) {
          if (acquiredSelectionInterest) {
            await releaseSelectionInterest(operationId());
          }
          return;
        }
      }
      if (event.type !== "SELECT_VERSION" && !isCleanup) {
        presentationStore.send(appId, event);
      }
      const id = operationId();
      const intent = toIntent(event, id);
      if (!intent) return;

      let unsubscribe: () => void = () => undefined;
      const settlement = waitForSettlement
        ? new Promise<void>((resolve, reject) => {
            const inspect = () => {
              const result = actor.getView().state.lastSettlement;
              if (result?.operationId !== id) return;
              unsubscribe();
              if (result.outcome === "succeeded") {
                resolve();
              } else {
                reject(
                  new Error(
                    result.error?.message ?? "Version operation failed",
                  ),
                );
              }
            };
            unsubscribe = actor.subscribe(inspect);
            inspect();
          })
        : Promise.resolve();
      try {
        if (isCleanup) {
          const releaseResult = await windowInterest.release(appId, id, {
            type: "close",
          });
          presentationStore.send(appId, event);
          if (!releaseResult.cleanupStarted) {
            unsubscribe();
            return;
          }
          if (actor.getView().state.state.type === "closed") {
            unsubscribe();
            return;
          }
          await settlement;
          return;
        }
        const receipt = await actor.dispatch(intent);
        if (receipt.kind === "applied") {
          if (event.type === "SELECT_VERSION") {
            selectionAccepted = true;
            presentationStore.send(appId, event);
          }
          await settlement;
          return;
        }
        throw new Error("The version operation was not accepted");
      } catch (error) {
        unsubscribe();
        if (
          event.type === "SELECT_VERSION" &&
          acquiredSelectionInterest &&
          !selectionAccepted
        ) {
          await releaseSelectionInterest(operationId());
        }
        throw error;
      }
    },
    [actor, appId, presentationStore, windowInterest],
  );
  const dispatch = useCallback(
    (event: PreviewEvent, waitForSettlement: boolean): Promise<void> => {
      if (event.type !== "SELECT_VERSION") {
        return dispatchNow(event, waitForSettlement);
      }
      const selectionEpoch = windowInterest.selectionEpoch(
        appId ?? NULL_APP_ID,
      );
      const operation = selectionQueue.current
        .catch(() => undefined)
        .then(async () => {
          await actor.resync();
          if (
            appId === null ||
            !windowInterest.isSelectionEpochCurrent(appId, selectionEpoch)
          ) {
            return;
          }
          await dispatchNow(event, waitForSettlement, selectionEpoch);
        });
      selectionQueue.current = operation.catch(() => undefined);
      return operation;
    },
    [actor, appId, dispatchNow, windowInterest],
  );
  const send = useCallback(
    (event: PreviewEvent) => {
      void dispatch(event, false).catch(() => {
        showError(
          "Version controls are temporarily unavailable. Please try again.",
        );
      });
    },
    [dispatch],
  );
  const sendAndWaitForMutation = useCallback(
    (event: PreviewEvent) => dispatch(event, true),
    [dispatch],
  );
  const projection = useMemo(() => {
    const projected = projectVersionPreview(state);
    if (remote.connection === "ready") return projected;
    return {
      ...projected,
      capabilities: {
        canRestore: false,
        canSelectVersion: false,
        canSwitchBranch: false,
      },
    };
  }, [remote.connection, state]);

  return {
    state,
    projection,
    isPaneVisible,
    send,
    sendAndWaitForMutation,
  };
}
