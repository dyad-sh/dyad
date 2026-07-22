import { atom } from "jotai";
import type { ImageThemeMode, GenerateImageResponse } from "@/ipc/types";

export type ImageGenerationStatus =
  | "pending"
  | "success"
  | "error"
  | "cancelled";

export interface ImageGenerationJob {
  id: string;
  prompt: string;
  themeMode: ImageThemeMode;
  targetAppId: number;
  targetAppName: string;
  status: ImageGenerationStatus;
  startedAt: number;
  result?: GenerateImageResponse;
  error?: string;
  source?: "chat" | "media-library";
  /** Success crossed the IPC boundary after cancellation was requested. */
  lateAfterCancel?: boolean;
}

const _imageGenerationJobsAtom = atom<ImageGenerationJob[]>([]);

/** Read-only legacy projection owned by ImageGenerationProvider. */
export const imageGenerationJobsAtom = atom((get) =>
  get(_imageGenerationJobsAtom),
);

/** The provider is the sole writer of the renderer machine projection. */
export const setImageGenerationJobsProjectionAtom = atom(
  null,
  (_get, set, jobs: ImageGenerationJob[]) =>
    set(_imageGenerationJobsAtom, jobs),
);

export const pendingImageGenerationsCountAtom = atom((get) => {
  const jobs = get(imageGenerationJobsAtom);
  return jobs.filter((job) => job.status === "pending").length;
});

export const chatImageGenerationJobsAtom = atom((get) => {
  const jobs = get(imageGenerationJobsAtom);
  // Only jobs with source === "chat" appear in the chat strip.
  // Jobs from media.tsx / library-home.tsx intentionally omit `source`
  // and therefore never appear here.
  return jobs.filter((job) => job.source === "chat");
});

/** Tracks dismissed job IDs globally so dismissals persist across mounts. */
export const dismissedImageGenerationJobIdsAtom = atom<Set<string>>(
  new Set<string>(),
);
