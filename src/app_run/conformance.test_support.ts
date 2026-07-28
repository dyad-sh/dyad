import { defineMachineConformance } from "@/distributed_machines/testing/machine_conformance";

export const appRunConformance = defineMachineConformance({
  machineId: "app_run",
  stateVariants: [
    "idle",
    "starting",
    "ready",
    "reloading",
    "stopping",
    "stopped",
    "errored",
  ],
  eventVariants: [
    "START",
    "RESTART",
    "STOP_REQUESTED",
    "MANUAL_RELOAD",
    "EXTERNAL_RESTART_STARTED",
    "PROCESS_SPAWNED",
    "PROCESS_FAILED",
    "PROCESS_STOPPED",
    "PROCESS_STOP_FAILED",
    "PROXY_READY",
    "HMR_DETECTED",
    "RELOAD_COMPLETED",
    "PROCESS_EXITED",
  ],
  tiers: ["T0", "T1", "T2"],
  exclusions: [
    {
      tier: "T3",
      reason:
        "The existing app-run actor declares restartPersistence=ephemeral.",
    },
    {
      tier: "T4",
      reason: "Cross-machine composition is outside the PR2 conformance shell.",
    },
  ],
  invariants: [
    {
      id: "key-relative-invocations",
      description: "Every non-idle invocation belongs to the routed app key.",
    },
    {
      id: "request-runtime-identity-separation",
      description:
        "Request operation IDs remain distinct from reused runtime invocation identity.",
    },
    {
      id: "settle-every-pending-operation",
      description: "Every tracked run/stop request settles or is disposed.",
    },
  ],
  representativeCapabilities: {
    canStart: ["START"],
    canRestart: ["RESTART"],
    canStop: ["STOP_REQUESTED"],
    canReload: ["MANUAL_RELOAD"],
  },
  representativeIntents: {
    START: () => ({
      type: "START",
      operationId: "request-start",
      startedAt: 1,
      expectedRevision: 0,
    }),
    RESTART: () => ({
      type: "RESTART",
      operation: "rebuild",
      operationId: "request-rebuild",
      startedAt: 1,
      expectedRevision: 0,
    }),
    STOP_REQUESTED: () => ({
      type: "STOP_REQUESTED",
      operationId: "request-stop",
      startedAt: 1,
      activeInvocationRef: {
        kind: "app-run",
        entityKey: 1,
        operationId: "runtime",
      },
    }),
    MANUAL_RELOAD: () => ({
      type: "MANUAL_RELOAD",
      operationId: "request-reload",
      startedAt: 1,
    }),
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
    "activation-reentry",
    "same-id-payload-conflict",
    "stale-release",
    "bootstrap-generation-regression",
    "abort-terminal-settlement",
  ],
});
