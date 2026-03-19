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
