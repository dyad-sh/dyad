import { z } from "zod";
import type { RequestId } from "@/distributed_machines/request_identity";
import type { InvocationRef } from "@/state_machines/invocation_ref";
import { SafeGitRefSchema } from "@/shared/git_refs";
import type {
  BranchSwitchFallback,
  PreviewError,
  PreviewEvent,
  PreviewSession,
  PreviewState,
} from "./state";

type SafeRemoteSession = Omit<
  PreviewSession,
  "selectedDiffFile" | "isDiffVisible"
> & {
  readonly selectedDiffFile: null;
  readonly isDiffVisible: false;
};

type SafeRemoteFallback =
  | Extract<BranchSwitchFallback, { type: "closed" }>
  | {
      [Kind in Exclude<
        BranchSwitchFallback["type"],
        "closed" | "recovery-required"
      >]: {
        readonly type: Kind;
        readonly session: SafeRemoteSession;
      };
    }[Exclude<BranchSwitchFallback["type"], "closed" | "recovery-required">]
  | {
      readonly type: "recovery-required";
      readonly session: SafeRemoteSession;
      readonly error: PreviewError;
    };

type SafeRemotePreviewState =
  | { readonly type: "closed" }
  | {
      [Kind in Exclude<
        PreviewState["type"],
        | "closed"
        | "restoring"
        | "switching-branch"
        | "recovery-required"
        | "restore-recovery-required"
      >]: {
        readonly type: Kind;
        readonly session: SafeRemoteSession;
      };
    }[Exclude<
      PreviewState["type"],
      | "closed"
      | "restoring"
      | "switching-branch"
      | "recovery-required"
      | "restore-recovery-required"
    >]
  | {
      readonly type: "restoring";
      readonly session: SafeRemoteSession;
      readonly fallback: "closed" | "browsing" | "previewing";
    }
  | {
      readonly type: "switching-branch";
      readonly appId: number;
      readonly branch: string;
      readonly fallback: SafeRemoteFallback;
    }
  | {
      readonly type: "recovery-required";
      readonly session: SafeRemoteSession;
      readonly error: PreviewError;
    }
  | {
      readonly type: "restore-recovery-required";
      readonly session: SafeRemoteSession;
      readonly error: PreviewError;
    };

type MutuallyAssignable<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;
type AssertTrue<Value extends true> = Value;

export const VERSION_PREVIEW_MACHINE_ID = "version_preview";
export const VERSION_PREVIEW_INVOCATION_KIND = "version-preview-operation";

const keys = new Map<number, { appId: number }>();

export function versionPreviewKey(appId: number): { appId: number } {
  let key = keys.get(appId);
  if (!key) {
    key = Object.freeze({ appId });
    keys.set(appId, key);
  }
  return key;
}

export const VersionPreviewKeySchema = z
  .object({ appId: z.number().int().nonnegative() })
  .strict()
  .transform(({ appId }) => Object.freeze({ appId }));
export type VersionPreviewKey = z.infer<typeof VersionPreviewKeySchema>;

export type VersionPreviewInvocationRef = InvocationRef<
  typeof VERSION_PREVIEW_INVOCATION_KIND,
  number
>;

export const VersionPreviewInvocationRefSchema = z
  .object({
    kind: z.literal(VERSION_PREVIEW_INVOCATION_KIND),
    entityKey: z.number().int().positive(),
    operationId: z.string().min(1),
  })
  .strict();

const currentChatMessageIdSchema = z
  .object({
    chatId: z.number().int().positive(),
    messageId: z.number().int().positive(),
  })
  .strict();

export const VersionPreviewIntentEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("ACQUIRE_WINDOW_INTEREST"),
      operationId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("RESTORE_WINDOW_INTEREST"),
      operationId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("RELEASE_WINDOW_INTEREST"),
      operationId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("CLOSE"),
      operationId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("APP_CHANGED"),
      nextAppId: z.number().int().positive().nullable(),
      operationId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("SELECT_VERSION"),
      versionId: SafeGitRefSchema,
      operationId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("SWITCH_BRANCH"),
      branch: SafeGitRefSchema,
      operationId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("RESTORE"),
      versionId: SafeGitRefSchema,
      expectedHeadOid: SafeGitRefSchema.optional(),
      currentChatMessageId: currentChatMessageIdSchema.optional(),
      operationId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("RESTORE_TO_MESSAGE"),
      chatId: z.number().int().positive(),
      messageId: z.number().int().positive(),
      restoreCodebase: z.boolean(),
      operationId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("RETRY_RETURN"),
      operationId: z.string().min(1),
    })
    .strict(),
]);
export type VersionPreviewIntentEvent = z.infer<
  typeof VersionPreviewIntentEventSchema
>;

export type VersionPreviewProducerEvent =
  | { type: "RECONCILE_REQUESTED" }
  | {
      type: "RECONCILED";
      branch: string | null;
      headOid: string | null;
      isClean: boolean;
    }
  | {
      type: "ORIGIN_RESOLVED";
      branch: string;
      invocationRef: VersionPreviewInvocationRef;
    }
  | {
      type: "ORIGIN_RESOLUTION_FAILED";
      invocationRef: VersionPreviewInvocationRef;
    }
  | {
      type: "CHECKOUT_SUCCEEDED";
      invocationRef: VersionPreviewInvocationRef;
    }
  | {
      type: "CHECKOUT_FAILED";
      error: PreviewError;
      invocationRef: VersionPreviewInvocationRef;
    }
  | {
      type: "RESTORE_SUCCEEDED";
      repositoryOutcome: "target-applied" | "unchanged";
      invocationRef: VersionPreviewInvocationRef;
    }
  | {
      type: "RESTORE_FAILED";
      error: PreviewError;
      invocationRef: VersionPreviewInvocationRef;
    }
  | {
      type: "RESTORE_RECOVERY_REQUIRED";
      error: PreviewError;
      restoreRecovery: import("./state").RestoreRecovery;
      invocationRef: VersionPreviewInvocationRef;
    }
  | {
      type: "RETURN_SUCCEEDED";
      invocationRef: VersionPreviewInvocationRef;
    }
  | {
      type: "RETURN_FAILED";
      error: PreviewError;
      invocationRef: VersionPreviewInvocationRef;
    }
  | {
      type: "SWITCH_BRANCH_SUCCEEDED";
      invocationRef: VersionPreviewInvocationRef;
    }
  | {
      type: "SWITCH_BRANCH_FAILED";
      error: PreviewError;
      invocationRef: VersionPreviewInvocationRef;
    };

export type VersionPreviewAdmittedIntent = VersionPreviewIntentEvent & {
  readonly requestId?: RequestId;
  readonly windowSessionId: string;
};

export type VersionPreviewCorrelatedProducerEvent =
  VersionPreviewProducerEvent & {
    readonly requestId?: RequestId;
    readonly operation?: import("./operations").VersionPreviewOperationKind;
  };

export type VersionPreviewActorEvent =
  | VersionPreviewAdmittedIntent
  | VersionPreviewCorrelatedProducerEvent
  | {
      readonly type: "WINDOW_INTEREST_DISPOSED";
      readonly windowSessionId: string;
    };

export type VersionPreviewWireEvent =
  | VersionPreviewIntentEvent
  | VersionPreviewProducerEvent;

export interface VersionPreviewSettlement {
  readonly operationId: string;
  readonly requestId?: string;
  readonly operation?: import("./operations").VersionPreviewOperationKind;
  readonly outcome: "succeeded" | "failed";
  readonly cleanupStarted?: boolean;
  readonly error?: PreviewError;
}

export interface VersionPreviewActorState {
  readonly state: PreviewState;
  readonly activeInvocationRef: VersionPreviewInvocationRef | null;
  readonly lastSettlement: VersionPreviewSettlement | null;
  /** Volatile presentation ownership. It is intentionally never persisted. */
  readonly windowInterestSessionIds?: readonly string[];
}

const previewErrorSchema = z.object({ message: z.string() }).strict();
const exitIntentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).strict(),
  z.object({ type: z.literal("close") }).strict(),
  z
    .object({
      type: z.literal("switch-app"),
      nextAppId: z.number().int().positive().nullable(),
    })
    .strict(),
]);
const sessionSchema = z
  .object({
    appId: z.number().int().nonnegative(),
    originBranch: z.string().nullable(),
    targetVersionId: z.string().nullable(),
    checkedOutVersionId: z.string().nullable(),
    exitIntent: exitIntentSchema,
    selectedDiffFile: z.null(),
    isDiffVisible: z.literal(false),
  })
  .strict();
const fallbackSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("closed") }).strict(),
  z
    .object({ type: z.literal("viewing-diff"), session: sessionSchema })
    .strict(),
  z.object({ type: z.literal("browsing"), session: sessionSchema }).strict(),
  z.object({ type: z.literal("previewing"), session: sessionSchema }).strict(),
  z
    .object({
      type: z.literal("recovery-required"),
      session: sessionSchema,
      error: previewErrorSchema,
    })
    .strict(),
]);
export const PreviewStateSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("closed") }).strict(),
  z
    .object({ type: z.literal("viewing-diff"), session: sessionSchema })
    .strict(),
  z.object({ type: z.literal("browsing"), session: sessionSchema }).strict(),
  z
    .object({ type: z.literal("resolving-origin"), session: sessionSchema })
    .strict(),
  z
    .object({ type: z.literal("checking-out"), session: sessionSchema })
    .strict(),
  z.object({ type: z.literal("previewing"), session: sessionSchema }).strict(),
  z
    .object({
      type: z.literal("restoring"),
      session: sessionSchema,
      fallback: z.enum(["closed", "browsing", "previewing"]),
    })
    .strict(),
  z.object({ type: z.literal("returning"), session: sessionSchema }).strict(),
  z
    .object({
      type: z.literal("switching-branch"),
      appId: z.number().int().nonnegative(),
      branch: z.string(),
      fallback: fallbackSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("recovery-required"),
      session: sessionSchema,
      error: previewErrorSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("restore-recovery-required"),
      session: sessionSchema,
      error: previewErrorSchema,
    })
    .strict(),
]);
type _PreviewStateSchemaMatchesSafeRemoteState = AssertTrue<
  MutuallyAssignable<z.infer<typeof PreviewStateSchema>, SafeRemotePreviewState>
>;
type _SafeRemoteStateIsAPreviewState = AssertTrue<
  SafeRemotePreviewState extends PreviewState ? true : false
>;
type _SafeRemoteStateCoversEveryDomainTag = AssertTrue<
  MutuallyAssignable<SafeRemotePreviewState["type"], PreviewState["type"]>
>;

export const VersionPreviewRemoteSnapshotSchema = z
  .object({
    appId: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    state: PreviewStateSchema,
    activeInvocationRef: VersionPreviewInvocationRefSchema.nullable(),
    lastSettlement: z
      .object({
        operationId: z.string(),
        outcome: z.enum(["succeeded", "failed"]),
        error: previewErrorSchema.optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type VersionPreviewRemoteSnapshot = z.infer<
  typeof VersionPreviewRemoteSnapshotSchema
>;

export function projectVersionPreviewRemoteSnapshot(
  appId: number,
  revision: number,
  actorState: VersionPreviewActorState,
): VersionPreviewRemoteSnapshot {
  return {
    appId,
    revision,
    state: stripWindowPresentation(actorState.state),
    activeInvocationRef: actorState.activeInvocationRef,
    lastSettlement:
      actorState.lastSettlement === null
        ? null
        : {
            operationId: actorState.lastSettlement.operationId,
            outcome: actorState.lastSettlement.outcome,
            ...(actorState.lastSettlement.error
              ? { error: actorState.lastSettlement.error }
              : {}),
          },
  };
}

function stripSessionPresentation(session: PreviewSession) {
  return {
    ...session,
    selectedDiffFile: null,
    isDiffVisible: false,
  } as const;
}

function stripWindowPresentation(state: PreviewState): SafeRemotePreviewState {
  switch (state.type) {
    case "closed":
      return state;
    case "switching-branch":
      return {
        ...state,
        fallback:
          state.fallback.type === "closed"
            ? state.fallback
            : state.fallback.type === "recovery-required"
              ? {
                  ...state.fallback,
                  session: stripSessionPresentation(state.fallback.session),
                }
              : {
                  ...state.fallback,
                  session: stripSessionPresentation(state.fallback.session),
                },
      };
    case "restoring": {
      const { restoreRecovery: _restoreRecovery, ...safeState } = state;
      return {
        ...safeState,
        session: stripSessionPresentation(state.session),
      };
    }
    case "restore-recovery-required": {
      const { restoreRecovery: _restoreRecovery, ...safeState } = state;
      return {
        ...safeState,
        session: stripSessionPresentation(state.session),
      };
    }
    default:
      return {
        ...state,
        session: stripSessionPresentation(state.session),
      };
  }
}

export function toPreviewDomainEvent(
  appId: number,
  event: VersionPreviewWireEvent,
): PreviewEvent {
  switch (event.type) {
    case "ACQUIRE_WINDOW_INTEREST":
    case "RESTORE_WINDOW_INTEREST":
    case "RELEASE_WINDOW_INTEREST":
      throw new Error(`${event.type} is handled by the hosted actor`);
    case "RECONCILE_REQUESTED":
    case "RECONCILED":
      throw new Error(`${event.type} is handled by the hosted actor`);
    case "CLOSE":
    case "RETRY_RETURN":
      return { type: event.type };
    case "APP_CHANGED":
      return { type: event.type, nextAppId: event.nextAppId };
    case "SELECT_VERSION":
      return { type: event.type, versionId: event.versionId };
    case "SWITCH_BRANCH":
      return { type: event.type, appId, branch: event.branch };
    case "RESTORE":
      return {
        type: event.type,
        appId,
        versionId: event.versionId,
        expectedHeadOid: event.expectedHeadOid,
        currentChatMessageId: event.currentChatMessageId,
      };
    case "RESTORE_TO_MESSAGE":
      return {
        type: event.type,
        appId,
        chatId: event.chatId,
        messageId: event.messageId,
        restoreCodebase: event.restoreCodebase,
      };
    case "ORIGIN_RESOLVED":
      return { type: event.type, branch: event.branch };
    case "ORIGIN_RESOLUTION_FAILED":
    case "CHECKOUT_SUCCEEDED":
    case "RETURN_SUCCEEDED":
    case "SWITCH_BRANCH_SUCCEEDED":
      return { type: event.type };
    case "CHECKOUT_FAILED":
    case "RESTORE_FAILED":
    case "RETURN_FAILED":
    case "SWITCH_BRANCH_FAILED":
      return { type: event.type, error: event.error };
    case "RESTORE_RECOVERY_REQUIRED":
      return {
        type: event.type,
        error: event.error,
        restoreRecovery: event.restoreRecovery,
      };
    case "RESTORE_SUCCEEDED":
      return {
        type: event.type,
        repositoryOutcome: event.repositoryOutcome,
      };
  }
}
