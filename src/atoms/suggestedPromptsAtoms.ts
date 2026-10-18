import { atom } from "jotai";

/**
 * Per chat, the assistant message whose follow-up prompt chips the user hid.
 * Only a chat's last message shows chips, so one entry per chat is enough.
 * Kept outside the strip so hiding survives remounts and chat switches.
 */
export const dismissedSuggestedPromptsByChatIdAtom = atom<Map<number, number>>(
  new Map<number, number>(),
);
