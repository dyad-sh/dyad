import type {
  ActorRuntimeMetadata,
  RemoteOperationContract,
} from "@/distributed_machines/definition";
import {
  OperationRegistry,
  createOperationOutcomePublisher,
  type OperationDisposalCause,
  type OperationLookupIdentity,
  type OperationOwner,
} from "@/distributed_machines/operation_registry";
import type { RequestId } from "@/distributed_machines/request_identity";
import {
  githubOpsDisposalReason,
  type GithubOpsCorrelatedOutcome,
  type GithubOpsOperationOutcome,
} from "@/github_ops/state";
import {
  GITHUB_OPS_INVOCATION_KIND,
  GITHUB_OPS_MACHINE_ID,
  type GithubOpsInvocationRef,
  type GithubOpsIntentEvent,
  type GithubOpsKey,
  type GithubOpsTrustedIntentEvent,
  type GithubOpsWireEvent,
} from "@/github_ops/transport";
import { systemClock, type Clock } from "@/state_machines/clock";
import { githubOpsPresentationService } from "./github_ops_presentation_service";

export const GITHUB_OPS_MAX_PENDING_OPERATIONS = 64;
export const GITHUB_OPS_MAX_RETAINED_OPERATIONS = 128;

type TrackedGithubOpsEvent = Extract<
  GithubOpsTrustedIntentEvent,
  { type: "OP_REQUESTED" | "ABORT_AND_SWITCH_CONFIRMED" }
>;

function isTrackedGithubOpsEvent(
  event: GithubOpsWireEvent,
): event is TrackedGithubOpsEvent {
  return (
    event.type === "OP_REQUESTED" || event.type === "ABORT_AND_SWITCH_CONFIRMED"
  );
}

export class GithubOpsOperationService {
  readonly registry: OperationRegistry<
    GithubOpsOperationOutcome,
    GithubOpsInvocationRef
  >;

  constructor(private readonly clock: Clock = systemClock) {
    this.registry = new OperationRegistry<
      GithubOpsOperationOutcome,
      GithubOpsInvocationRef
    >({
      maxUnresolved: GITHUB_OPS_MAX_PENDING_OPERATIONS,
      maxSettledReplay: GITHUB_OPS_MAX_RETAINED_OPERATIONS,
      now: () => this.clock.now(),
      disposalOutcome: (cause) => ({
        kind: "cancelled",
        reason: githubOpsDisposalReason(cause),
      }),
      supersededOutcome: () => ({
        kind: "cancelled",
        reason: "superseded",
      }),
      enqueueFailureOutcome: (error) => ({
        kind: "failed",
        operation: "unknown",
        failure: {
          kind: "unexpected",
          message: error instanceof Error ? error.message : String(error),
        },
      }),
    });
  }

  remoteContract(): RemoteOperationContract<
    GithubOpsKey,
    GithubOpsIntentEvent,
    GithubOpsWireEvent,
    GithubOpsOperationOutcome,
    GithubOpsInvocationRef
  > {
    return {
      prepare: ({
        key,
        event,
        sender,
        actor,
        hostId,
        fingerprint,
        requestIdentity,
      }) => {
        if (!isTrackedGithubOpsEvent(event)) return undefined;
        if (!requestIdentity) {
          throw new Error("Tracked GitHub operation requires request identity");
        }
        const owner: OperationOwner = {
          hostId,
          machineId: GITHUB_OPS_MACHINE_ID,
          keyId: String(key.appId),
          actorInstanceId: actor.actorInstanceId,
          actorRevision: actor.snapshotRevision,
          windowSessionId: sender.windowSessionId,
        };
        const identity: OperationLookupIdentity = {
          requestId: requestIdentity.requestId,
          fingerprint,
          owner,
        };
        return {
          registry: this.registry,
          identity,
          createInvocationRef: () => ({
            kind: GITHUB_OPS_INVOCATION_KIND,
            entityKey: key.appId,
            operationId: event.operationId,
          }),
        };
      },
      ignoredOutcome: (reason) => ({
        kind: "rejected",
        reason: reason as Extract<
          GithubOpsOperationOutcome,
          { kind: "rejected" }
        >["reason"],
      }),
      receipt: (actor) => ({
        actor,
        acknowledgedAt: this.clock.now(),
      }),
      releaseManager: () => this.registry.releaseOwned("host", () => true),
    };
  }

  createPublisher(getMetadata: () => ActorRuntimeMetadata) {
    const publish = createOperationOutcomePublisher(
      this.registry,
      (_outcome: GithubOpsCorrelatedOutcome) => ({
        actor: getMetadata(),
        acknowledgedAt: this.clock.now(),
      }),
    );
    const publisher = (outcome: GithubOpsCorrelatedOutcome): void => {
      githubOpsPresentationService.markTerminal(
        outcome.invocationRef.operationId,
      );
      publish(outcome);
    };
    publisher.publishBatch = (
      outcomes: readonly GithubOpsCorrelatedOutcome[],
    ): void => {
      for (const outcome of outcomes) {
        githubOpsPresentationService.markTerminal(
          outcome.invocationRef.operationId,
        );
      }
      publish.publishBatch?.(outcomes);
    };
    return publisher;
  }

  ticketFor(requestId: RequestId, windowSessionId: string) {
    return this.registry.ticketFor(
      requestId,
      (owner) => owner.windowSessionId === windowSessionId,
    );
  }

  settleActor(actorInstanceId: string): number {
    const settled = this.registry.settleActor(actorInstanceId);
    githubOpsPresentationService.releaseOwner(actorInstanceId);
    return settled;
  }

  releaseActor(actorInstanceId: string): number {
    githubOpsPresentationService.releaseOwner(actorInstanceId);
    return this.registry.releaseOwned(
      "actor",
      (owner) => owner.actorInstanceId === actorInstanceId,
    );
  }

  settleKey(keyId: string): number {
    return this.registry.settleKey(
      "main-remote-machine-host",
      GITHUB_OPS_MACHINE_ID,
      keyId,
    );
  }

  settleMachine(): number {
    return this.registry.settleMachine(
      "main-remote-machine-host",
      GITHUB_OPS_MACHINE_ID,
    );
  }

  settle(cause: OperationDisposalCause): number {
    return this.registry.settleDisposed(cause);
  }

  inspect() {
    return this.registry.inspect();
  }
}

export const githubOpsOperationService = new GithubOpsOperationService();
