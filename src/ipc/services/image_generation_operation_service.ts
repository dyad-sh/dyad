import {
  OperationRegistry,
  createOperationOutcomePublisher,
  type OperationAdmissionIdentity,
  type OperationDisposalCause,
  type OperationOwner,
} from "@/distributed_machines/operation_registry";
import type { RequestId } from "@/distributed_machines/request_identity";
import type {
  ActorRuntimeMetadata,
  RemoteOperationContract,
} from "@/distributed_machines/definition";
import type {
  ImageGenerationCorrelatedOutcome,
  ImageGenerationEvent,
  ImageGenerationIntentEvent,
  ImageGenerationInvocationRef,
  ImageGenerationOperationOutcome,
} from "@/image_generation/state";
import type { ImageGenerationKey } from "@/image_generation/transport";
import { systemClock, type Clock } from "@/state_machines/clock";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export const IMAGE_GENERATION_MAX_PENDING_OPERATIONS = 64;
export const IMAGE_GENERATION_MAX_RETAINED_OPERATIONS = 128;

function sameInvocation(
  left: ImageGenerationInvocationRef,
  right: ImageGenerationInvocationRef,
): boolean {
  return (
    left.kind === right.kind &&
    left.entityKey === right.entityKey &&
    left.operationId === right.operationId
  );
}

export class ImageGenerationOperationService {
  readonly registry: OperationRegistry<
    ImageGenerationOperationOutcome,
    ImageGenerationInvocationRef
  >;

  constructor(private readonly clock: Clock = systemClock) {
    this.registry = new OperationRegistry<
      ImageGenerationOperationOutcome,
      ImageGenerationInvocationRef
    >({
      maxUnresolved: IMAGE_GENERATION_MAX_PENDING_OPERATIONS,
      maxSettledReplay: IMAGE_GENERATION_MAX_RETAINED_OPERATIONS,
      now: () => this.clock.now(),
      sameInvocationRef: sameInvocation,
      // A stable-id retry can outlive the receipt ledger and arrive after the
      // actor has advanced. Reattachment remains bound to the same actor
      // instance and initiator, while the original admission revision is not
      // treated as operation identity.
      sameOwnerForReattachment: (left, right) =>
        left.hostId === right.hostId &&
        left.machineId === right.machineId &&
        left.keyId === right.keyId &&
        left.actorInstanceId === right.actorInstanceId &&
        left.windowSessionId === right.windowSessionId,
      disposalOutcome: (cause) => ({
        kind: "disposed",
        jobId: "",
        cause,
      }),
      supersededOutcome: () => ({
        kind: "disposed",
        jobId: "",
        cause: "actor",
      }),
      enqueueFailureOutcome: () => ({
        kind: "failed",
        jobId: "",
        message: "Image generation admission failed",
        failureKind: "unexpected",
      }),
    });
  }

  remoteContract(): RemoteOperationContract<
    ImageGenerationKey,
    ImageGenerationIntentEvent,
    ImageGenerationEvent,
    ImageGenerationOperationOutcome,
    ImageGenerationInvocationRef
  > {
    return {
      prepare: ({ intent, sender, actor, hostId, fingerprint }) => {
        if (intent.type !== "SUBMIT") return undefined;
        const invocationRef: ImageGenerationInvocationRef = {
          kind: "image-generation",
          entityKey: intent.job.id,
          operationId: intent.operationId,
        };
        const owner: OperationOwner = {
          hostId,
          machineId: "image_generation",
          keyId: `app:${intent.job.targetAppId}`,
          actorInstanceId: actor.actorInstanceId,
          actorRevision: actor.snapshotRevision,
          windowSessionId: sender.windowSessionId,
        };
        const identity: OperationAdmissionIdentity<ImageGenerationInvocationRef> =
          {
            requestId: intent.requestId,
            invocationRef,
            fingerprint,
            owner,
          };
        return { registry: this.registry, identity };
      },
      ignoredOutcome: (reason) => ({
        kind: "rejected",
        jobId: "",
        reason: reason as ImageGenerationOperationOutcome extends {
          kind: "rejected";
          reason: infer Reason;
        }
          ? Reason
          : never,
      }),
      receipt: (actor) => ({
        actor,
        acknowledgedAt: this.clock.now(),
      }),
      releaseManager: () => this.registry.releaseOwned("host", () => true),
    };
  }

  createPublisher(getMetadata: () => ActorRuntimeMetadata) {
    return createOperationOutcomePublisher(
      this.registry,
      (_outcome: ImageGenerationCorrelatedOutcome) => ({
        actor: getMetadata(),
        acknowledgedAt: this.clock.now(),
      }),
    );
  }

  async waitFor(requestId: string): Promise<ImageGenerationOperationOutcome> {
    const ticket = this.registry.ticketFor(requestId as RequestId, () => true);
    if (!ticket) {
      throw new DyadError(
        "Image generation operation not found",
        DyadErrorKind.NotFound,
      );
    }
    return (await ticket.settled).outcome;
  }

  settleActor(actorInstanceId: string): number {
    return this.registry.settleActor(actorInstanceId);
  }

  releaseActor(actorInstanceId: string): number {
    return this.registry.releaseOwned(
      "actor",
      (owner) => owner.actorInstanceId === actorInstanceId,
    );
  }

  releaseApp(appId: number): number {
    return this.registry.releaseOwned(
      "key",
      (owner) => owner.keyId === `app:${appId}`,
    );
  }

  settle(cause: OperationDisposalCause): number {
    return this.registry.settleDisposed(cause);
  }

  inspect() {
    return this.registry.inspect();
  }
}

export const imageGenerationOperationService =
  new ImageGenerationOperationService();
