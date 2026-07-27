import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { apps } from "@/db/schema";
import type { DistributedMachineDefinition } from "@/distributed_machines/definition";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import {
  IMAGE_GENERATION_MACHINE_ID,
  ImageGenerationIntentEventSchema,
  ImageGenerationKeySchema,
  ImageGenerationRemoteSnapshotSchema,
  getImageGenerationKey,
  projectImageGenerationRemoteSnapshot,
  sameImageGenerationInvocation,
  type ImageGenerationKey,
} from "@/image_generation/transport";
import {
  type ImageGenerationActorState,
  type ImageGenerationCommand,
  type ImageGenerationEvent,
  type ImageGenerationIgnoreReason,
  type ImageGenerationIntentEvent,
} from "@/image_generation/state";
import { isTerminal, transition } from "@/image_generation/transition";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
import { imageGenerationPresentationService } from "./image_generation_presentation_service";
import { imageGenerationService } from "./image_generation_service";

export const IMAGE_GENERATION_TERMINAL_RETENTION_MS = 30 * 60 * 1000;

function createCommandRunner(
  context: import("@/distributed_machines/definition").MachineHostContext<
    ImageGenerationKey,
    ImageGenerationActorState,
    ImageGenerationEvent
  >,
) {
  return (command: ImageGenerationCommand): void => {
    switch (command.type) {
      case "GenerateImage":
        void imageGenerationService
          .generate({
            requestId: command.invocationRef.operationId,
            prompt: command.params.prompt,
            themeMode: command.params.themeMode,
            targetAppId: command.params.targetAppId,
          })
          .then(
            (result) =>
              context.send({
                type: "JOB_SUCCEEDED",
                jobId: command.jobId,
                invocationRef: command.invocationRef,
                result,
              }),
            (error) =>
              context.send({
                type: "JOB_FAILED",
                jobId: command.jobId,
                invocationRef: command.invocationRef,
                message: error instanceof Error ? error.message : String(error),
                kind:
                  isDyadError(error) &&
                  error.kind === DyadErrorKind.UserCancelled
                    ? "user_cancelled"
                    : "other",
              }),
          );
        return;
      case "RequestCancel": {
        const cancelled = imageGenerationService.cancel(
          command.invocationRef.operationId,
        );
        context.send({
          type: "CANCEL_CONFIRMED",
          jobId: command.jobId,
          invocationRef: command.invocationRef,
          cancelled,
        });
        return;
      }
      case "SchedulePrune":
        context.timers.replace(
          `terminal:${command.jobId}`,
          command.jobId,
          IMAGE_GENERATION_TERMINAL_RETENTION_MS,
          (jobId) => ({ type: "PRUNE_JOB", jobId: String(jobId) }),
          context.send,
        );
        return;
      case "Present":
        imageGenerationPresentationService.present(
          context.getSnapshot(),
          command.jobId,
        );
        return;
      case "InvalidateMediaQueries":
        queryInvalidationBus.publish([{ family: "media" }]);
        return;
      default:
        return assertNever(command);
    }
  };
}

async function appExists(appId: number): Promise<boolean> {
  const app = await db.query.apps.findFirst({
    columns: { id: true },
    where: eq(apps.id, appId),
  });
  return !!app;
}

type ImageGenerationDefinition = DistributedMachineDefinition<
  typeof IMAGE_GENERATION_MACHINE_ID,
  ImageGenerationKey,
  ImageGenerationActorState,
  ImageGenerationEvent,
  ImageGenerationCommand,
  ImageGenerationIgnoreReason
> & {
  readonly host: "main";
  readonly remote: NonNullable<
    DistributedMachineDefinition<
      typeof IMAGE_GENERATION_MACHINE_ID,
      ImageGenerationKey,
      ImageGenerationActorState,
      ImageGenerationEvent,
      ImageGenerationCommand,
      ImageGenerationIgnoreReason
    >["remote"]
  >;
};

export const imageGenerationDefinition: ImageGenerationDefinition = {
  id: IMAGE_GENERATION_MACHINE_ID,
  host: "main",
  initialState: (): ImageGenerationActorState => ({ jobs: [] }),
  transition: (state, event) => transition(state, event),
  createScheduler: () => ({
    schedule(batch, execute) {
      for (const command of batch.commands) void execute(command);
    },
  }),
  createCommandRunner,
  createBeforeCommit: (context) => (previous, next) => {
    const nextIds = new Set(next.jobs.map(({ job }) => job.id));
    for (const { job } of previous.jobs) {
      if (!nextIds.has(job.id)) {
        context.timers.remove(`terminal:${job.id}`);
      }
    }
  },
  lifecycle: {
    subscriptionCreates: true,
    dispatchCreates: false,
    idleEviction: { kind: "retain" },
    terminalRetention: {
      kind: "dispose-after",
      delayMs: IMAGE_GENERATION_TERMINAL_RETENTION_MS,
    },
    entityDeletion: "retain",
    rendererOwnership: "host",
    survivesRendererReload: true,
    restartPersistence: "ephemeral",
    flushOnShutdown: true,
    isTerminal: (state) =>
      state.jobs.length > 0 && state.jobs.every(({ job }) => isTerminal(job)),
    flush: () => imageGenerationService.cancelAndSettleAll(),
    onDisposed: () => imageGenerationPresentationService.clear(),
  },
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    keyCodec: ImageGenerationKeySchema,
    encodeKey: () => getImageGenerationKey(),
    canonicalizeKeyAfterAuthorization: () => getImageGenerationKey(),
    eventCodec:
      ImageGenerationIntentEventSchema as z.ZodType<ImageGenerationEvent>,
    snapshotCodec: ImageGenerationRemoteSnapshotSchema,
    keyToString: () => "jobs",
    projectSnapshot: (state, _key, metadata) =>
      projectImageGenerationRemoteSnapshot(state, metadata.snapshotRevision),
    unavailableSnapshot: () => ({ jobs: [], revision: 0 }),
    revisionPolicy: () => "allow-stale",
    authorizeSubscribe: () => {},
    authorizeDispatch: async ({ sender, event, currentState }) => {
      const intent = event as ImageGenerationIntentEvent;
      if (intent.type === "SUBMIT") {
        if (!(await appExists(intent.job.targetAppId))) {
          throw new DyadError("Target app not found", DyadErrorKind.Auth);
        }
        if (!currentState?.jobs.some(({ job }) => job.id === intent.job.id)) {
          imageGenerationPresentationService.recordInitiator(
            intent.job.id,
            sender.windowSessionId,
          );
        }
        return;
      }
      if (
        intent.activeInvocationRef.entityKey !== intent.jobId ||
        !sameImageGenerationInvocation(
          currentState?.jobs.find(({ job }) => job.id === intent.jobId)
            ?.activeInvocationRef ?? null,
          intent.activeInvocationRef,
        )
      ) {
        throw new DyadError(
          "Cancellation does not target the active image generation",
          DyadErrorKind.Auth,
        );
      }
    },
  },
};

function assertNever(value: never): never {
  throw new Error(
    `Unexpected image-generation command: ${JSON.stringify(value)}`,
  );
}
