import { atom } from "jotai";

/**
 * Assistant message IDs whose follow-up prompt chips the user hid. Kept
 * outside the strip so hiding survives remounts and chat switches.
 */
export const dismissedSuggestedPromptMessageIdsAtom = atom<Set<number>>(
  new Set<number>(),
);
