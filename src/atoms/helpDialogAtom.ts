import { atom } from "jotai";

export interface HelpDialogState {
  open: boolean;
  // When set, the Help dialog opens directly into the chat-session upload
  // (review) flow for this chat instead of the main help screen. Used by the
  // crash dialog to skip straight to uploading the chat that was last active.
  uploadChatId?: number;
}

export const helpDialogAtom = atom<HelpDialogState>({ open: false });
