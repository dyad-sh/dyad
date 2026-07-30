import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import {
  useDistributedMachine,
  useRemoteMachineClient,
} from "@/distributed_machines/react";
import { useMachineMutation } from "@/distributed_machines/use_machine_mutation";
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
import {
  observeVersionPreviewAdmission,
  useVersionPreviewRequestActor,
} from "@/version_preview/request_actor";
import type { VersionPreviewOperationOutcome } from "@/version_preview/operations";
import type { PreparedRequestSettlement } from "@/distributed_machines/prepared_request";

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
  const requestActor = useVersionPreviewRequestActor(routedAppId);
  const mutation = useMachineMutation<
    {
      readonly event: PreviewEvent;
      readonly operationId: string;
      readonly onAdmitted: () => void;
    },
    import("@/version_preview/request_actor").VersionPreviewAdmission,
    VersionPreviewOperationOutcome,
    import("@/version_preview/request_actor").VersionPreviewRefusal,
    { readonly message: string }
  >({
    connection: remote.connection,
    snapshot: remote.snapshot ?? { kind: "unavailable" },
    request: (input, observedRevision) => {
      const intent = toIntent(input.event, input.operationId);
      if (!intent) {
        throw new Error(`${input.event.type} is presentation-only`);
      }
      const prepared = requestActor.request({
        intent,
        observed: observedRevision,
      });
      // mutate() owns authoritative error/settlement handling. This observer
      // only commits local presentation after admission, and consumes its own
      // rejection so a failed admission cannot become an unhandled promise.
      void observeVersionPreviewAdmission(prepared, input.onAdmitted).catch(
        () => undefined,
      );
      return prepared;
    },
    classifyOutcome: (outcome) => {
      switch (outcome.kind) {
        case "succeeded":
          return { kind: "succeeded" };
        case "cancelled":
          return outcome.reason === "superseded"
            ? { kind: "superseded" }
            : { kind: "cancelled" };
        case "failed":
          return { kind: "failed", error: outcome.error };
      }
    },
    requestOwnership: "parallel",
  });
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

  const requestPreview = useCallback(
    async (
      event: PreviewEvent,
      _waitForSettlement: boolean,
      selectionEpoch?: number,
    ): Promise<void> => {
      if (appId === null) return;
      const isCleanup = event.type === "CLOSE" || event.type === "APP_CHANGED";
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
      const id = operationId();
      const intent = toIntent(event, id);
      if (!intent) {
        presentationStore.send(appId, event);
        return;
      }

      try {
        if (isCleanup) {
          const releaseResult = await windowInterest.release(
            appId,
            id,
            event.type === "APP_CHANGED"
              ? { type: "switch-app", nextAppId: event.nextAppId }
              : { type: "close" },
          );
          presentationStore.send(appId, event);
          if (!releaseResult.cleanupStarted) return;
          return;
        }
        let resolveAdmission!: () => void;
        const admitted = new Promise<void>((resolve) => {
          resolveAdmission = resolve;
        });
        const completion = mutation.mutate({
          event,
          operationId: id,
          onAdmitted: () => {
            if (event.type === "SELECT_VERSION") {
              selectionAccepted = true;
            }
            presentationStore.send(appId, event);
            resolveAdmission();
          },
        });
        if (!_waitForSettlement) {
          const early = await Promise.race([
            admitted.then(() => null),
            completion,
          ]);
          if (early === null) return;
          if (
            early.kind === "completed" &&
            early.outcome.kind === "succeeded"
          ) {
            return;
          }
          throw settlementError(early);
        }
        const settlement = await completion;
        if (
          settlement.kind === "completed" &&
          settlement.outcome.kind === "succeeded"
        ) {
          return;
        }
        throw settlementError(settlement);
      } catch (error) {
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
    [appId, mutation, presentationStore, windowInterest],
  );
  const dispatch = useCallback(
    (event: PreviewEvent, waitForSettlement: boolean): Promise<void> => {
      if (event.type !== "SELECT_VERSION") {
        return requestPreview(event, waitForSettlement);
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
          await requestPreview(event, waitForSettlement, selectionEpoch);
        });
      selectionQueue.current = operation.catch(() => undefined);
      return operation;
    },
    [actor, appId, requestPreview, windowInterest],
  );
  const send = useCallback(
    (event: PreviewEvent) => {
      void dispatch(event, false).catch((error) => {
        if (error instanceof VersionPreviewExpectedSettlementError) return;
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

type VersionPreviewExpectedSettlement =
  | Extract<
      PreparedRequestSettlement<
        VersionPreviewOperationOutcome,
        import("@/version_preview/request_actor").VersionPreviewRefusal
      >,
      { readonly kind: "completed" }
    >
  | {
      readonly kind: "not-admitted";
      readonly reason: "refused" | "disposed";
      readonly refusal?: import("@/version_preview/request_actor").VersionPreviewRefusal;
    };

export class VersionPreviewExpectedSettlementError extends Error {
  readonly name = "VersionPreviewExpectedSettlementError";

  constructor(readonly settlement: VersionPreviewExpectedSettlement) {
    super(expectedSettlementMessage(settlement));
  }
}

function expectedSettlementMessage(
  settlement: VersionPreviewExpectedSettlement,
): string {
  if (settlement.kind === "not-admitted") {
    return `The version operation was not accepted: ${settlement.refusal ?? settlement.reason}`;
  }
  if (settlement.outcome.kind === "failed") {
    return settlement.outcome.error.message;
  }
  if (settlement.outcome.kind === "cancelled") {
    return `The version operation was ${settlement.outcome.reason}`;
  }
  return "The version operation did not complete";
}

function settlementError(
  settlement: PreparedRequestSettlement<
    VersionPreviewOperationOutcome,
    import("@/version_preview/request_actor").VersionPreviewRefusal
  >,
): Error {
  if (settlement.kind === "not-admitted") {
    if (settlement.reason !== "disconnected") {
      return new VersionPreviewExpectedSettlementError({
        kind: "not-admitted",
        reason: settlement.reason,
        ...(settlement.refusal === undefined
          ? {}
          : { refusal: settlement.refusal }),
      });
    }
    return new Error(
      `The version operation was not accepted: ${settlement.refusal ?? settlement.reason}`,
    );
  }
  if (settlement.kind === "detached") {
    return new Error("The version operation detached before completion");
  }
  return new VersionPreviewExpectedSettlementError(settlement);
}
