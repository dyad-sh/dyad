import { z } from "zod";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import type { RemoteClientDefinition } from "@/distributed_machines/remote_client";
import { ImageThemeModeSchema } from "@/ipc/types/image_generation";
import {
  IMAGE_GENERATION_INVOCATION_KIND,
  type ImageGenerationActorState,
  type ImageGenerationIgnoreReason,
  type ImageGenerationIntentEvent,
  type ImageGenerationInvocationRef,
  type ImageGenerationJobView,
} from "./state";

export const IMAGE_GENERATION_MACHINE_ID = "image_generation";

const imageGenerationKey = Object.freeze({ scope: "jobs" as const });
export type ImageGenerationKey = typeof imageGenerationKey;

export function getImageGenerationKey(): ImageGenerationKey {
  return imageGenerationKey;
}

export const ImageGenerationKeySchema = z
  .object({ scope: z.literal("jobs") })
  .strict()
  .transform(() => imageGenerationKey);

export const ImageGenerationInvocationRefSchema = z
  .object({
    kind: z.literal(IMAGE_GENERATION_INVOCATION_KIND),
    entityKey: z.string().min(1),
    operationId: z.string().min(1),
  })
  .strict();

const startParamsSchema = z
  .object({
    prompt: z.string().min(1).max(2000),
    themeMode: ImageThemeModeSchema,
    targetAppId: z.number().int().positive(),
    targetAppName: z.string().min(1),
    source: z.enum(["chat", "media-library"]).optional(),
  })
  .strict();

const jobDetailsSchema = startParamsSchema
  .extend({
    id: z.string().min(1),
    startedAt: z.number().finite(),
  })
  .strict();

export const ImageGenerationIntentEventSchema = z.union([
  z
    .object({
      type: z.literal("SUBMIT"),
      job: jobDetailsSchema,
      operationId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("CANCEL_REQUESTED"),
      jobId: z.string().min(1),
      activeInvocationRef: ImageGenerationInvocationRefSchema,
    })
    .strict(),
]) satisfies z.ZodType<ImageGenerationIntentEvent>;

const resultViewSchema = z
  .object({
    fileName: z.string(),
    appId: z.number().int().positive(),
    appName: z.string(),
  })
  .strict();

const imageGenerationJobViewSchema = jobDetailsSchema
  .extend({
    status: z.enum(["pending", "cancelling", "success", "error", "cancelled"]),
    result: resultViewSchema.optional(),
    error: z.string().optional(),
    lateAfterCancel: z.boolean().optional(),
    activeInvocationRef: ImageGenerationInvocationRefSchema.nullable(),
  })
  .strict() satisfies z.ZodType<ImageGenerationJobView>;

export const ImageGenerationRemoteSnapshotSchema = z
  .object({
    jobs: z.array(imageGenerationJobViewSchema),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type ImageGenerationRemoteSnapshot = z.infer<
  typeof ImageGenerationRemoteSnapshotSchema
>;

export function projectImageGenerationRemoteSnapshot(
  state: ImageGenerationActorState,
  revision: number,
): ImageGenerationRemoteSnapshot {
  return {
    jobs: state.jobs.map(({ job, activeInvocationRef }) => ({
      id: job.id,
      startedAt: job.startedAt,
      prompt: job.prompt,
      themeMode: job.themeMode,
      targetAppId: job.targetAppId,
      targetAppName: job.targetAppName,
      ...(job.source ? { source: job.source } : {}),
      status: job.status,
      ...(job.result
        ? {
            result: {
              fileName: job.result.fileName,
              appId: job.result.appId,
              appName: job.result.appName,
            },
          }
        : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(job.lateAfterCancel !== undefined
        ? { lateAfterCancel: job.lateAfterCancel }
        : {}),
      activeInvocationRef,
    })),
    revision,
  };
}

export const imageGenerationClientDefinition = {
  id: IMAGE_GENERATION_MACHINE_ID,
  host: "main",
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    keyCodec: ImageGenerationKeySchema,
    encodeKey: () => imageGenerationKey,
    eventCodec: ImageGenerationIntentEventSchema,
    snapshotCodec: ImageGenerationRemoteSnapshotSchema,
    keyToString: () => "jobs",
    unavailableSnapshot: () => ({ jobs: [], revision: 0 }),
  },
} satisfies RemoteClientDefinition<
  ImageGenerationKey,
  ImageGenerationRemoteSnapshot,
  ImageGenerationIntentEvent,
  ImageGenerationIgnoreReason
>;

export function sameImageGenerationInvocation(
  left: ImageGenerationInvocationRef | null,
  right: ImageGenerationInvocationRef,
): boolean {
  return (
    left?.kind === right.kind &&
    left.entityKey === right.entityKey &&
    left.operationId === right.operationId
  );
}
