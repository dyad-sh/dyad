import { atom } from "jotai";
/** Tracks dismissed job IDs globally so dismissals persist across mounts. */
export const dismissedImageGenerationJobIdsAtom = atom<Set<string>>(
  new Set<string>(),
);
