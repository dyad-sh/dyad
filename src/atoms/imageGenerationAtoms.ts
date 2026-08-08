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
}

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

const _imageGenerationJobsAtom = atom<ImageGenerationJob[]>([]);

/** Writable atom that auto-prunes completed jobs older than 30 minutes on every write. */
export const imageGenerationJobsAtom = atom(
  (get) => get(_imageGenerationJobsAtom),
  (
    _get,
    set,
    update:
      | ImageGenerationJob[]
      | ((prev: ImageGenerationJob[]) => ImageGenerationJob[]),
  ) => {
    set(_imageGenerationJobsAtom, (prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      const cutoff = Date.now() - THIRTY_MINUTES_MS;
      return next.filter(
        (job) => job.status === "pending" || job.startedAt > cutoff,
      );
    });
  },
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
