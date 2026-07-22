/**
 * Image jobs run concurrently and are keyed by a manager-minted job ID.
 * Events are serialized per job. Once a job is terminal, every later event is
 * ignored. Cancellation is best-effort: a success already crossing the IPC
 * boundary becomes a visible late success instead of an orphaned file.
 */

import type { GenerateImageResponse, ImageThemeMode } from "@/ipc/types";

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

export type ImageGenerationState =
  | { type: "pending"; job: ImageGenerationJobDetails }
  | { type: "cancelling"; job: ImageGenerationJobDetails }
  | {
      type: "succeeded";
      job: ImageGenerationJobDetails;
      result: GenerateImageResponse;
      lateAfterCancel: boolean;
    }
  | { type: "failed"; job: ImageGenerationJobDetails; message: string }
  | { type: "cancelled"; job: ImageGenerationJobDetails };

export type ImageGenerationFailureKind = "user_cancelled" | "other";

export type ImageGenerationEvent =
  | { type: "JOB_SUCCEEDED"; result: GenerateImageResponse }
  | {
      type: "JOB_FAILED";
      message: string;
      kind: ImageGenerationFailureKind;
    }
  | { type: "CANCEL_REQUESTED" }
  | { type: "CANCEL_CONFIRMED"; cancelled: boolean };

export type ImageGenerationCommand =
  | {
      type: "GenerateImage";
      jobId: string;
      params: StartImageGenerationParams;
    }
  | { type: "RequestCancel"; jobId: string }
  | { type: "InvalidateMediaQueries" };

export type ImageGenerationIgnoreReason =
  | "already-cancelling"
  | "already-terminal"
  | "invalid-in-current-state";

export type ImageGenerationTransitionResult =
  import("@/state_machines/types").TransitionResult<
    ImageGenerationState,
    ImageGenerationCommand,
    ImageGenerationIgnoreReason
  >;
