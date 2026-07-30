import {
  defineMachineConformance,
  defineVariantInventory,
} from "@/distributed_machines/testing/machine_conformance";
import type { PreviewState } from "./state";
import type { VersionPreviewActorEvent } from "./transport";

const versionPreviewStateVariants = defineVariantInventory<
  PreviewState["type"]
>()([
  "closed",
  "viewing-diff",
  "browsing",
  "resolving-origin",
  "checking-out",
  "previewing",
  "restoring",
  "returning",
  "switching-branch",
  "recovery-required",
  "restore-recovery-required",
]);

const versionPreviewEventVariants = defineVariantInventory<
  VersionPreviewActorEvent["type"]
>()([
  "ACQUIRE_WINDOW_INTEREST",
  "RESTORE_WINDOW_INTEREST",
  "RELEASE_WINDOW_INTEREST",
  "CLOSE",
  "APP_CHANGED",
  "SELECT_VERSION",
  "SWITCH_BRANCH",
  "RESTORE",
  "RESTORE_TO_MESSAGE",
  "RETRY_RETURN",
  "RECONCILE_REQUESTED",
  "RECONCILED",
  "ORIGIN_RESOLVED",
  "ORIGIN_RESOLUTION_FAILED",
  "CHECKOUT_SUCCEEDED",
  "CHECKOUT_FAILED",
  "RESTORE_SUCCEEDED",
  "RESTORE_FAILED",
  "RESTORE_RECOVERY_REQUIRED",
  "RETURN_SUCCEEDED",
  "RETURN_FAILED",
  "SWITCH_BRANCH_SUCCEEDED",
  "SWITCH_BRANCH_FAILED",
  "WINDOW_INTEREST_DISPOSED",
]);

export const versionPreviewConformance = defineMachineConformance({
  machineId: "version_preview",
  stateVariants: versionPreviewStateVariants,
  eventVariants: versionPreviewEventVariants,
  tiers: ["T0", "T1", "T2", "T3"],
  exclusions: [
    {
      tier: "T4",
      reason:
        "Version preview coordinates app-run only through an existing service boundary; cross-machine atomic composition is not part of Phase 3A.",
    },
  ],
  invariants: [
    {
      id: "identity-domains-remain-distinct",
      description:
        "Request, message, idempotency, invocation, actor, preview, and Git revision identities are never aliased.",
    },
    {
      id: "tracked-intents-settle-authoritatively",
      description:
        "Every tracked renderer intent settles, is superseded, or is disposed through OperationRegistry.",
    },
    {
      id: "volatile-ownership-is-not-persisted",
      description:
        "Window leases, operation routes, request ownership, and admission fences never enter protocol-v1 snapshots or persisted preview state.",
    },
    {
      id: "recovery-format-and-ordering-unchanged",
      description:
        "Phase 3A preserves existing persistence and recovery ordering without claiming checkpoint-before-effect guarantees.",
    },
  ],
  representativeCapabilities: {
    canAcquireInterest: ["acquire-interest"],
    canRestoreInterest: ["restore-interest"],
    canReleaseInterest: ["release-interest"],
    canClose: ["close"],
    canSwitchApp: ["switch-app"],
    canSelectVersion: ["select-version"],
    canSwitchBranch: ["switch-branch"],
    canRestore: ["restore", "restore-to-message"],
    canRetryReturn: ["retry-return"],
  },
  representativeIntents: {
    "acquire-interest": {
      event: "ACQUIRE_WINDOW_INTEREST",
      create: () => ({
        type: "ACQUIRE_WINDOW_INTEREST",
        operationId: "interest",
      }),
    },
    "restore-interest": {
      event: "RESTORE_WINDOW_INTEREST",
      create: () => ({
        type: "RESTORE_WINDOW_INTEREST",
        operationId: "restore-interest",
      }),
    },
    "release-interest": {
      event: "RELEASE_WINDOW_INTEREST",
      create: () => ({
        type: "RELEASE_WINDOW_INTEREST",
        operationId: "release-interest",
      }),
    },
    close: {
      event: "CLOSE",
      create: () => ({ type: "CLOSE", operationId: "close" }),
    },
    "switch-app": {
      event: "APP_CHANGED",
      create: () => ({
        type: "APP_CHANGED",
        nextAppId: 2,
        operationId: "switch-app",
      }),
    },
    "select-version": {
      event: "SELECT_VERSION",
      create: () => ({
        type: "SELECT_VERSION",
        versionId: "abc123",
        operationId: "select",
      }),
    },
    "switch-branch": {
      event: "SWITCH_BRANCH",
      create: () => ({
        type: "SWITCH_BRANCH",
        branch: "main",
        operationId: "switch-branch",
      }),
    },
    restore: {
      event: "RESTORE",
      create: () => ({
        type: "RESTORE",
        versionId: "abc123",
        operationId: "restore",
      }),
    },
    "restore-to-message": {
      event: "RESTORE_TO_MESSAGE",
      create: () => ({
        type: "RESTORE_TO_MESSAGE",
        chatId: 1,
        messageId: 1,
        restoreCodebase: true,
        operationId: "restore-message",
      }),
    },
    "retry-return": {
      event: "RETRY_RETURN",
      create: () => ({
        type: "RETRY_RETURN",
        operationId: "retry-return",
      }),
    },
  },
  historicalFailureShapes: [
    "construction-disposal-recreation",
    "post-authorization-actor-window-change",
    "unsubscribe-during-bootstrap",
    "refresh-acquires-ownership",
    "unresolved-receipt-under-pressure",
    "request-runtime-identity-alias",
    "disposal-with-unresolved-work",
    "ingress-through-deletion-fence",
    "late-producer-actor-recreation",
    "ui-mutation-before-authoritative-admission",
    "same-id-payload-conflict",
    "stale-release",
    "bootstrap-generation-regression",
    "error-classification-collapse",
    "error-instance-wire-outcome",
    "cross-actor-supersession",
    "closed-window-route-terminal-retention",
    "abort-terminal-settlement",
  ],
});
