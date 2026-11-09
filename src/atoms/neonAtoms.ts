import { atom } from "jotai";

// Dismissal is per app and lasts for this renderer session. Reconnection remains
// available outside chat, and restarting Dyad shows the reminder again.
export const dismissedNeonReconnectionAppIdsAtom = atom<ReadonlySet<number>>(
  new Set<number>(),
);
