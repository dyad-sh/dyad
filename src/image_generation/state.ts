/**
 * Image generation is a main-owned collection actor. Jobs run concurrently,
 * while events for the shared collection are serialized by ActorHost.
 *
 * Job IDs are renderer-minted idempotency identities. Invocation refs are
 * separate correlation identities and cancellation must target the exact
 * active invocation. Provider settlements are host-only.
 */

import type { InvocationRef } from "@/state_machines/invocation_ref";

export const IMAGE_GENERATION_INVOCATION_KIND = "image-generation";

export type ImageThemeMode =
  | "plain"
  | "3d-clay"
  | "real-photography"
  | "isometric-illustration";

export interface GenerateImageResponse {
  fileName: string;
  filePath: string;
  appPath: string;
  appId: number;
  appName: string;
}

export type ImageGenerationResultView = Omit<GenerateImageResponse, "filePath">;

export interface StartImageGenerationParams {
  prompt: string;
  themeMode: ImageThemeMode;
  targetAppId: number;
  targetAppName: string;
  source?: "chat" | "media-library";
}

export interface ImageGenerationJobDetails extends StartImageGenerationParams {
  id: string;
  startedAt: number;
}

export type ImageGenerationStatus =
  | "pending"
  | "cancelling"
  | "success"
  | "error"
  | "cancelled";

export interface ImageGenerationJob extends ImageGenerationJobDetails {
  status: ImageGenerationStatus;
  result?: GenerateImageResponse;
  error?: string;
  /** Success crossed the main command boundary after cancellation. */
  lateAfterCancel?: boolean;
}

export interface ImageGenerationJobView extends ImageGenerationJobDetails {
  status: ImageGenerationStatus;
  result?: ImageGenerationResultView;
  error?: string;
  lateAfterCancel?: boolean;
  activeInvocationRef: ImageGenerationInvocationRef | null;
}

export type ImageGenerationInvocationRef = InvocationRef<
  typeof IMAGE_GENERATION_INVOCATION_KIND,
  string
>;

export interface ImageGenerationActorJob {
  readonly job: ImageGenerationJob;
  readonly activeInvocationRef: ImageGenerationInvocationRef | null;
}

export interface ImageGenerationActorState {
  readonly jobs: readonly ImageGenerationActorJob[];
}

export type ImageGenerationFailureKind = "user_cancelled" | "other";

export type SubmitImageGenerationEvent = {
  readonly type: "SUBMIT";
  readonly job: ImageGenerationJobDetails;
  readonly operationId: string;
};

export type CancelImageGenerationEvent = {
  readonly type: "CANCEL_REQUESTED";
  readonly jobId: string;
  readonly activeInvocationRef: ImageGenerationInvocationRef;
};

export type ImageGenerationIntentEvent =
  | SubmitImageGenerationEvent
  | CancelImageGenerationEvent;

export type ImageGenerationProducerEvent =
  | {
      readonly type: "JOB_SUCCEEDED";
      readonly jobId: string;
      readonly invocationRef: ImageGenerationInvocationRef;
      readonly result: GenerateImageResponse;
    }
  | {
      readonly type: "JOB_FAILED";
      readonly jobId: string;
      readonly invocationRef: ImageGenerationInvocationRef;
      readonly message: string;
      readonly kind: ImageGenerationFailureKind;
    }
  | {
      readonly type: "CANCEL_CONFIRMED";
      readonly jobId: string;
      readonly invocationRef: ImageGenerationInvocationRef;
      readonly cancelled: boolean;
    }
  | { readonly type: "PRUNE_JOB"; readonly jobId: string }
  | { readonly type: "APP_DELETED"; readonly appId: number };

export type ImageGenerationEvent =
  | ImageGenerationIntentEvent
  | ImageGenerationProducerEvent;

export type ImageGenerationCommand =
  | {
      readonly type: "GenerateImage";
      readonly jobId: string;
      readonly invocationRef: ImageGenerationInvocationRef;
      readonly params: StartImageGenerationParams;
    }
  | {
      readonly type: "RequestCancel";
      readonly jobId: string;
      readonly invocationRef: ImageGenerationInvocationRef;
    }
  | {
      readonly type: "SchedulePrune";
      readonly jobId: string;
    }
  | {
      readonly type: "Present";
      readonly jobId: string;
    }
  | { readonly type: "InvalidateMediaQueries" };

export type ImageGenerationIgnoreReason =
  | "already-cancelling"
  | "already-terminal"
  | "duplicate-job"
  | "job-id-conflict"
  | "operation-id-conflict"
  | "job-not-found"
  | "stale-operation";

export type ImageGenerationTransitionResult =
  import("@/state_machines/types").TransitionResult<
    ImageGenerationActorState,
    ImageGenerationCommand,
    ImageGenerationIgnoreReason
  >;
