import {
  defineMachineConformance,
  defineVariantInventory,
} from "@/distributed_machines/testing/machine_conformance";
import type { GithubOpsState } from "./state";
import type { GithubOpsWireEvent } from "./transport";

const githubOpsStateVariants = defineVariantInventory<GithubOpsState["type"]>()(
  ["idle", "running", "conflicted", "rebase-paused", "switch-blocked"],
);

const githubOpsEventVariants = defineVariantInventory<
  GithubOpsWireEvent["type"]
>()([
  "OP_REQUESTED",
  "ABORT_AND_SWITCH_CONFIRMED",
  "BLOCKED_DISMISSED",
  "RESOLVE_WITH_AI_STARTED",
  "BANNER_DISMISSED",
  "RECONCILE_REQUESTED",
  "CONFLICT_RESOLUTION_STARTED",
  "CONFLICT_RESOLUTION_CANCELLED",
  "OP_SUCCEEDED",
  "OP_FAILED",
  "CONFLICTS",
  "GIT_STATE",
  "CONFLICT_RESOLUTION_CLAIM_EXPIRED",
  "CONFLICT_RESOLUTION_CLAIM_REARM_REQUESTED",
]);

export const githubOpsConformance = defineMachineConformance({
  machineId: "github_ops",
  stateVariants: githubOpsStateVariants,
  eventVariants: githubOpsEventVariants,
  tiers: ["T0", "T1", "T2"],
  exclusions: [
    {
      tier: "T3",
      reason:
        "GitHub operation actors reconcile Git state after restart instead of persisting in-memory operation state.",
    },
    {
      tier: "T4",
      reason:
        "GitHub operations have no state-machine dependency and require no cross-machine composition tier.",
    },
  ],
  invariants: [
    {
      id: "one-operation-per-app",
      description: "At most one Git operation invocation is active per app.",
    },
    {
      id: "trusted-git-outcomes",
      description:
        "Git and probe outcomes enter only through actor-generation-bound producer sinks.",
    },
    {
      id: "authoritative-operation-settlement",
      description:
        "Tracked requests settle only from committed correlated outcomes or an explicit lifecycle terminal.",
    },
    {
      id: "destructive-admission-fence",
      description:
        "App deletion and reset reject new GitHub work and drain admitted continuations before commit.",
    },
  ],
  representativeCapabilities: {
    canSync: ["push"],
    canCancelSync: ["abort"],
    canResolveConflicts: ["resolve"],
  },
  representativeIntents: {
    push: {
      event: "OP_REQUESTED",
      create: () => ({
        type: "OP_REQUESTED",
        operationId: "push-operation",
        op: { type: "push", mode: "normal" },
      }),
    },
    abort: {
      event: "OP_REQUESTED",
      create: () => ({
        type: "OP_REQUESTED",
        operationId: "abort-operation",
        op: { type: "rebase-abort" },
      }),
    },
    resolve: {
      event: "RESOLVE_WITH_AI_STARTED",
      create: () => ({
        type: "RESOLVE_WITH_AI_STARTED",
        claimId: "claim",
      }),
    },
  },
  historicalFailureShapes: [
    "post-authorization-actor-window-change",
    "unresolved-receipt-under-pressure",
    "request-runtime-identity-alias",
    "disposal-with-unresolved-work",
    "ingress-through-deletion-fence",
    "late-producer-actor-recreation",
    "ui-mutation-before-authoritative-admission",
    "same-id-payload-conflict",
    "stale-release",
    "error-classification-collapse",
    "abort-terminal-settlement",
  ],
});
